#!/usr/bin/env node
// 并发分段下载本次运行的一个 artifact，再解压到目录（#99）。部署 job 用它代替 actions/download-artifact：
// 自托管 runner 在家里，单连接从 GitHub 的 Azure 存储下载只有几十 KB/s，163MB 的镜像归档要一小时；
// 同一个地址并发 16 段 Range 请求合计约 6.6MB/s（2026-09-26 在 crosery-arch 的部署容器里实测）。
//
//   GH_TOKEN=… node scripts/fetch-artifact.mjs --repo <owner/repo> --run <运行 ID> --name <artifact 名> --dir <目录> [--parts 16]
//
// 令牌只从环境变量 GH_TOKEN（或 GITHUB_TOKEN）读，不进命令行。下载地址约 1 分钟过期，所以每一段失败重试时都重新取地址。
// 这里只核对总字节数与 zip 自带的 CRC；归档内容由目标机的 sha256sum -c 核对（与原来一样）。
import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, realpathSync, rmSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const API = 'https://api.github.com';
const USAGE = 'node scripts/fetch-artifact.mjs --repo <owner/repo> --run <运行 ID> --name <artifact 名> --dir <目录> [--parts 16]';

export function parseArgs(argv) {
  const options = { parts: 16 };
  for (let i = 0; i < argv.length; i += 1) {
    const [key, value] = [argv[i], argv[i + 1]];
    if (!['--repo', '--run', '--name', '--dir', '--parts'].includes(key)) throw new Error(`不认识的参数 ${key}；用法：${USAGE}`);
    if (value === undefined || value.startsWith('--')) throw new Error(`${key} 缺值`);
    options[key.slice(2)] = key === '--parts' ? Number(value) : value;
    i += 1;
  }
  for (const key of ['repo', 'run', 'name', 'dir']) if (!options[key]) throw new Error(`缺 --${key}；用法：${USAGE}`);
  if (!/^[\w.-]+\/[\w.-]+$/.test(options.repo)) throw new Error(`--repo 不是 owner/repo：${options.repo}`);
  if (!/^\d+$/.test(options.run)) throw new Error(`--run 不是运行 ID：${options.run}`);
  if (!Number.isInteger(options.parts) || options.parts < 1 || options.parts > 64) throw new Error('--parts 要在 1 到 64 之间');
  return options;
}

/** 把 [0, size) 切成 parts 段，返回每段的闭区间 [start, end]；段数不超过字节数。 */
export function ranges(size, parts) {
  const count = Math.max(1, Math.min(parts, size));
  const chunk = Math.ceil(size / count);
  const out = [];
  for (let start = 0; start < size; start += chunk) out.push([start, Math.min(size, start + chunk) - 1]);
  return out;
}

async function apiJson(fetchImpl, token, path) {
  const response = await fetchImpl(`${API}${path}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error(`GitHub API ${path} 返回 ${response.status}`);
  return response.json();
}

/** 找本次运行里名字对上、没过期的 artifact。 */
export async function findArtifact(fetchImpl, token, { repo, run, name }) {
  const body = await apiJson(fetchImpl, token, `/repos/${repo}/actions/runs/${run}/artifacts?name=${encodeURIComponent(name)}&per_page=100`);
  const hits = (body.artifacts ?? []).filter(artifact => artifact.name === name && !artifact.expired);
  if (hits.length !== 1) throw new Error(`运行 ${run} 里名为 ${name} 的 artifact 有 ${hits.length} 个，应为 1 个`);
  return { id: hits[0].id, size: hits[0].size_in_bytes };
}

/** 取 zip 的临时下载地址（GitHub 返回 302，地址约 1 分钟过期）。 */
export async function downloadUrl(fetchImpl, token, { repo }, id) {
  const response = await fetchImpl(`${API}/repos/${repo}/actions/artifacts/${id}/zip`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
    redirect: 'manual',
  });
  const location = response.headers.get('location');
  if (response.status !== 302 || !location) throw new Error(`取 artifact ${id} 的下载地址失败：${response.status}`);
  return location;
}

/**
 * 下载一段，写到文件的对应偏移。失败（网络错误、非 206、长度不对）重新取地址再试，最多 attempts 次。
 * 下载地址是存储的签名 URL，不带 GitHub 令牌。
 */
export async function fetchRange({ fetchImpl, token, options, id, fd, write, start, end, attempts = 5, pause = ms => new Promise(r => setTimeout(r, ms)) }) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const url = await downloadUrl(fetchImpl, token, options, id);
      const response = await fetchImpl(url, { headers: { range: `bytes=${start}-${end}` } });
      if (response.status !== 206) throw new Error(`第 ${start}-${end} 段返回 ${response.status}，不是 206`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length !== end - start + 1) throw new Error(`第 ${start}-${end} 段收到 ${bytes.length} 字节`);
      write(fd, bytes, start);
      return bytes.length;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await pause(2000 * attempt);
    }
  }
  throw new Error(`第 ${start}-${end} 段重试 ${attempts} 次仍失败：${lastError.message}`);
}

export function defaultDeps() {
  return {
    fetchImpl: globalThis.fetch,
    open: path => openSync(path, 'w', 0o600),
    write: (fd, bytes, position) => { writeSync(fd, bytes, 0, bytes.length, position); },
    close: fd => closeSync(fd),
    unzip: (zip, dir) => execFileSync('unzip', ['-o', '-q', zip, '-d', dir], { stdio: 'inherit' }),
    mkdir: dir => mkdirSync(dir, { recursive: true }),
    remove: path => rmSync(path, { force: true }),
    log: message => console.log(`[fetch-artifact] ${message}`),
  };
}

export async function fetchArtifact(options, token, deps = defaultDeps()) {
  if (!token) throw new Error('缺 GH_TOKEN（或 GITHUB_TOKEN）');
  const { id, size } = await findArtifact(deps.fetchImpl, token, options);
  const pieces = ranges(size, options.parts);
  deps.log(`artifact ${options.name}（${id}）${size} 字节，分 ${pieces.length} 段并发下载`);
  deps.mkdir(options.dir);
  const zip = join(options.dir, `.${id}.zip`);
  const started = Date.now();
  try {
    const fd = deps.open(zip);
    let total = 0;
    try {
      const got = await Promise.all(pieces.map(([start, end]) => fetchRange({ fetchImpl: deps.fetchImpl, token, options, id, fd, write: deps.write, start, end, pause: deps.pause })));
      total = got.reduce((sum, n) => sum + n, 0);
    } finally {
      deps.close(fd);
    }
    if (total !== size) throw new Error(`共收到 ${total} 字节，artifact 是 ${size} 字节`);
    const seconds = Math.max(0.001, (Date.now() - started) / 1000);
    deps.log(`下载完成：${(size / 1048576).toFixed(1)}MB，${seconds.toFixed(1)} 秒`);
    deps.unzip(zip, options.dir);
  } finally {
    deps.remove(zip);
  }
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(realpathSync(resolve(process.argv[1]))).href === import.meta.url;
  } catch {
    return false;
  }
}
if (isDirectRun()) {
  (async () => {
    const options = parseArgs(process.argv.slice(2));
    await fetchArtifact(options, process.env.GH_TOKEN || process.env.GITHUB_TOKEN);
  })().catch(error => {
    console.error(`[fetch-artifact] 失败：${error.message}`);
    process.exit(1);
  });
}
