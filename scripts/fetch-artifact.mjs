#!/usr/bin/env node
// 并发分段下载本次运行的一个 artifact，再解压到目录（#99）。部署 job 用它代替 actions/download-artifact：
// 自托管 runner 在家里，单连接从 GitHub 的 Azure 存储下载只有几十 KB/s，163MB 的镜像归档要一小时；
// 同一个地址并发 16 段 Range 请求合计约 6.6MB/s（2026-09-26 在 crosery-arch 的部署容器里实测）。
//
//   GH_TOKEN=… node scripts/fetch-artifact.mjs --repo <owner/repo> --run <运行 ID> --name <artifact 名> --dir <目录> [--parts 16] [--idle-seconds 60]
//
// 令牌只从环境变量 GH_TOKEN（或 GITHUB_TOKEN）读，不进命令行。下载地址约 1 分钟过期，所以每一段失败重试时都重新取地址。
// 一段连续 --idle-seconds 秒没收到数据（连接卡住、不报错）也算失败，断开重试（#111）。
// 这里只核对总字节数与 zip 自带的 CRC；归档内容由目标机的 sha256sum -c 核对（与原来一样）。
import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, realpathSync, rmSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const API = 'https://api.github.com';
const USAGE = 'node scripts/fetch-artifact.mjs --repo <owner/repo> --run <运行 ID> --name <artifact 名> --dir <目录> [--parts 16] [--idle-seconds 60]';
// 家里单连接只有 40–220KB/s，几十 MB 的一段要传好几分钟，所以只限「多久没收到数据」，不限一段的总时长
const IDLE_MS = 60_000;

export function parseArgs(argv) {
  const options = { parts: 16 };
  for (let i = 0; i < argv.length; i += 1) {
    const [key, value] = [argv[i], argv[i + 1]];
    if (!['--repo', '--run', '--name', '--dir', '--parts', '--idle-seconds'].includes(key)) throw new Error(`不认识的参数 ${key}；用法：${USAGE}`);
    if (value === undefined || value.startsWith('--')) throw new Error(`${key} 缺值`);
    if (key === '--idle-seconds') {
      const seconds = Number(value);
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 600) throw new Error('--idle-seconds 要在 1 到 600 之间');
      options.idleMs = seconds * 1000;
    } else options[key.slice(2)] = key === '--parts' ? Number(value) : value;
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

// API 连不上时同样会卡住不报错：整个请求限 idleMs，不然部署要空等到 job 超时
async function apiJson(fetchImpl, token, path, idleMs = IDLE_MS) {
  const signal = AbortSignal.timeout(idleMs);
  try {
    const response = await fetchImpl(`${API}${path}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' }, signal });
    if (!response.ok) throw new Error(`GitHub API ${path} 返回 ${response.status}`);
    return await response.json();
  } catch (error) {
    if (signal.aborted) throw new Error(`GitHub API ${path} ${idleMs / 1000} 秒没响应`);
    throw error;
  }
}

/**
 * 找本次运行里名字对上、没过期的 artifact。同名多个时（重跑全部 job）取 id 最大的，也就是最新的，
 * 与 actions/download-artifact 一致。
 */
export async function findArtifact(fetchImpl, token, { repo, run, name, idleMs }) {
  const body = await apiJson(fetchImpl, token, `/repos/${repo}/actions/runs/${run}/artifacts?name=${encodeURIComponent(name)}&per_page=100`, idleMs);
  const hits = (body.artifacts ?? []).filter(artifact => artifact.name === name && !artifact.expired);
  if (!hits.length) throw new Error(`运行 ${run} 里没有名为 ${name} 的 artifact`);
  const newest = hits.reduce((a, b) => (b.id > a.id ? b : a));
  return { id: newest.id, size: newest.size_in_bytes, count: hits.length };
}

/** 取 zip 的临时下载地址（GitHub 返回 302，地址约 1 分钟过期）。 */
export async function downloadUrl(fetchImpl, token, { repo }, id, signal) {
  const response = await fetchImpl(`${API}/repos/${repo}/actions/artifacts/${id}/zip`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
    redirect: 'manual',
    signal,
  });
  const location = response.headers.get('location');
  if (response.status !== 302 || !location) throw new Error(`取 artifact ${id} 的下载地址失败：${response.status}`);
  return location;
}

/**
 * 下载一段，写到文件的对应偏移。失败（网络错误、非 206、长度不对）重新取地址再试，最多 attempts 次。
 * 下载地址是存储的签名 URL，不带 GitHub 令牌。别的段已经失败（signal 已取消）就不再重试。
 * 连接卡住不会报错：从取地址到收完，每次等数据（响应头或下一块）超过 idleMs 就取消这一次，按失败重试。
 */
export async function fetchRange({ fetchImpl, token, options, id, fd, write, start, end, signal, attempts = 5, idleMs = IDLE_MS, pause = ms => new Promise(r => setTimeout(r, ms)) }) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (signal?.aborted) throw new Error('已取消：别的段失败了');
    const attemptController = new AbortController();
    const attemptSignal = signal ? AbortSignal.any([signal, attemptController.signal]) : attemptController.signal;
    let idle = false;
    let timer;
    const waitData = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { idle = true; attemptController.abort(); }, idleMs);
    };
    try {
      waitData();
      const url = await downloadUrl(fetchImpl, token, options, id, attemptSignal);
      waitData();
      const response = await fetchImpl(url, { headers: { range: `bytes=${start}-${end}` }, signal: attemptSignal });
      if (response.status !== 206) throw new Error(`第 ${start}-${end} 段返回 ${response.status}，不是 206`);
      const chunks = [];
      const reader = response.body?.getReader();
      for (;;) {
        waitData();
        const { done, value } = reader ? await reader.read() : { done: true };
        if (done) break;
        chunks.push(value);
      }
      const bytes = Buffer.concat(chunks);
      if (bytes.length !== end - start + 1) throw new Error(`第 ${start}-${end} 段收到 ${bytes.length} 字节`);
      write(fd, bytes, start);
      return bytes.length;
    } catch (error) {
      if (signal?.aborted) throw new Error('已取消：别的段失败了');
      lastError = idle ? new Error(`第 ${start}-${end} 段 ${idleMs / 1000} 秒没收到数据`) : error;
    } finally {
      // 计时器不能留着让进程多等；失败的这一次（比如非 206 没读的响应体）也断开连接
      clearTimeout(timer);
      attemptController.abort();
    }
    if (attempt < attempts) await pause(2000 * attempt);
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
  const { id, size, count } = await findArtifact(deps.fetchImpl, token, options);
  if (count > 1) deps.log(`本次运行里有 ${count} 个同名 artifact，取最新的 ${id}`);
  const pieces = ranges(size, options.parts);
  deps.log(`artifact ${options.name}（${id}）${size} 字节，分 ${pieces.length} 段并发下载`);
  deps.mkdir(options.dir);
  const zip = join(options.dir, `.${id}.zip`);
  const started = Date.now();
  try {
    const fd = deps.open(zip);
    // 一段失败就取消其余段，并等所有段都停下再关文件：不会有写入落在关闭之后
    const controller = new AbortController();
    const results = await Promise.allSettled(pieces.map(([start, end]) =>
      fetchRange({ fetchImpl: deps.fetchImpl, token, options, id, fd, write: deps.write, start, end, signal: controller.signal, idleMs: options.idleMs, pause: deps.pause })
        .catch(error => { controller.abort(); throw error; })));
    deps.close(fd);
    const failure = results.find(result => result.status === 'rejected' && !/^已取消/.test(result.reason.message))
      ?? results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    const total = results.reduce((sum, result) => sum + result.value, 0);
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
