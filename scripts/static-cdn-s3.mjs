// CDN 的 path-style S3 / SigV4 适配器。只读环境，不读取凭据文件；不实现删除或覆盖接口。
import { createHash, createHmac } from 'node:crypto';
import { S3_BUCKET_RE, STATIC_CDN_PREFIX, STATIC_CDN_S3_ENDPOINT } from './static-cdn-base.mjs';

export const S3_REGION = 'cn-south-1';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const CDN_MIME_TYPES = Object.freeze({
  js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  svg: 'image/svg+xml', ico: 'image/x-icon', wasm: 'application/wasm', glb: 'model/gltf-binary',
});

/** 未配置两项凭据时保持同源；配置了一半、旧 token 或非合同目的地均失败关闭。 */
export function readS3Config(env = process.env) {
  if (env.STATIC_CDN_UPLOAD_TOKEN?.trim()) throw new Error('STATIC_CDN_UPLOAD_TOKEN 已退役；只接受 S3 环境凭据');
  const accessKey = env.STATIC_CDN_S3_ACCESS_KEY_ID?.trim() ?? '';
  const secretKey = env.STATIC_CDN_S3_SECRET_ACCESS_KEY ?? '';
  if (!accessKey && !secretKey) return null;
  if (!accessKey || !secretKey || /[\s:\x00-\x1f\x7f]/.test(accessKey) || /[\x00-\x1f\x7f]/.test(secretKey)) {
    throw new Error('须提供完整且合法的 STATIC_CDN_S3_ACCESS_KEY_ID / STATIC_CDN_S3_SECRET_ACCESS_KEY');
  }
  const endpoint = env.STATIC_CDN_S3_ENDPOINT || STATIC_CDN_S3_ENDPOINT;
  const bucket = env.STATIC_CDN_S3_BUCKET?.trim() ?? '';
  const region = env.STATIC_CDN_S3_REGION || S3_REGION;
  if (endpoint !== STATIC_CDN_S3_ENDPOINT || !S3_BUCKET_RE.test(bucket) || region !== S3_REGION
    || (env.STATIC_CDN_S3_FORCE_PATH_STYLE && env.STATIC_CDN_S3_FORCE_PATH_STYLE !== 'true')) {
    throw new Error('S3 目的地必须是固定七牛端点、STATIC_CDN_S3_BUCKET 给出的桶、cn-south-1、forcePathStyle=true');
  }
  return { endpoint, bucket, region, forcePathStyle: true, accessKey, secretKey };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const MAX_BYTES = 10 * 1024 * 1024;
/** 单次请求超时的上限（毫秒）。大文件从海外上传到 cn-south-1 时 15 秒不够，见 uploadTimeoutMs。 */
export const MAX_TIMEOUT_MS = 180000;
/** 上传按这个速率估算需要的时间：每秒 16 KiB 以上才算正常；超过就放宽超时，而不是白白重试（#360）。 */
export const UPLOAD_BYTES_PER_SECOND = 16 * 1024;
/**
 * PUT 的超时 = 基础超时与「15 秒 + 体积 / 每秒字节数」取大者，最多 MAX_TIMEOUT_MS。
 * 覆盖的是响应头加响应体；GET 与 HEAD 仍用基础超时。
 */
export function uploadTimeoutMs(baseMs, bytes) {
  return Math.min(MAX_TIMEOUT_MS, Math.max(baseMs, 15000 + Math.ceil((bytes * 1000) / UPLOAD_BYTES_PER_SECOND)));
}
/** 上传并发数：环境变量 STATIC_CDN_UPLOAD_CONCURRENCY，未设为 4，允许 1–8 的整数。 */
export function readUploadConcurrency(env = process.env) {
  const raw = (env.STATIC_CDN_UPLOAD_CONCURRENCY ?? '').trim();
  if (!raw) return 4;
  if (!/^[1-8]$/.test(raw)) throw new Error('STATIC_CDN_UPLOAD_CONCURRENCY 必须是 1–8 的整数');
  return Number(raw);
}
const hmac = (key, text) => createHmac('sha256', key).update(text).digest();

export function assertStorageKey(key) {
  const parts = typeof key === 'string' ? key.split('/') : [];
  if (!parts.length || key.length > 300 || !/^[a-zA-Z0-9_./-]+$/.test(key)
    || parts.some(part => !part || part === '.' || part === '..' || part.startsWith('.'))
    || !(/^(?:yzgc\/static\/site\/(?:assets|console-assets|forum\/(?:_nuxt|guides|stickers|published))\/.+|yzgc\/indexes\/releases\/(?:production|preview)\/[0-9a-f]{40}\/manifest\.json)$/.test(key))) {
    throw new Error('拒绝写入：对象键不在 CDN 允许范围或包含恶意路径');
  }
  if (key.startsWith(STATIC_CDN_PREFIX)) {
    const hash = '[A-Za-z0-9_-]{8}';
    const name = '[A-Za-z0-9_.-]+';
    const valid = [
      new RegExp(`^yzgc/static/site/(?:assets|console-assets)/${name}-${hash}\\.[a-z0-9]+$`),
      new RegExp(`^yzgc/static/site/forum/_nuxt/(?:${hash}\\.js|${name}\\.${hash}\\.[a-z0-9]+|builds/meta/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.json)$`),
      new RegExp(`^yzgc/static/site/forum/guides/[a-z0-9-]+\\.${hash}\\.(?:webp|png)$`),
      /^yzgc\/static\/site\/forum\/stickers\/[0-9a-f]{64}\.webp$/,
      /^yzgc\/static\/site\/forum\/published\/[0-9a-f]{16}\.webp$/,
    ].some(pattern => pattern.test(key));
    if (!valid) throw new Error('拒绝写入：静态对象键必须保留合同中的内容哈希文件名');
  }
  return key;
}

export function assertObjectContent(key, body, mime) {
  assertStorageKey(key);
  if (!Buffer.isBuffer(body) || body.length > MAX_BYTES) throw new Error('对象必须是上限以内的 Buffer');
  if (!CDN_MIME_TYPES[key.split('.').at(-1)] || CDN_MIME_TYPES[key.split('.').at(-1)] !== mime) throw new Error('对象 Content-Type 类型不符合合同');
  if (key.startsWith(`${STATIC_CDN_PREFIX}forum/stickers/`) && key.split('/').at(-1) !== `${sha256(body)}.webp`) throw new Error('表情键与内容 SHA-256 不符');
  if (key.startsWith(`${STATIC_CDN_PREFIX}forum/guides/`) && key.split('.').at(-2) !== Buffer.from(sha256(body), 'hex').toString('base64url').slice(0, 8)) throw new Error('截图键与内容哈希不符');
  if (key.startsWith(`${STATIC_CDN_PREFIX}forum/published/`) && key.split('/').at(-1) !== `${sha256(body).slice(0, 16)}.webp`) throw new Error('旧帖图片键与内容 SHA-256 不符');
}

/** S3 不折叠路径、不用 ETag 校验内容；所有写入使用完整 payload SHA-256 签名。 */
export function signS3Request(config, method, key, { body = Buffer.alloc(0), headers = {}, now = Date.now() } = {}) {
  if (!['GET', 'HEAD', 'PUT'].includes(method)) throw new Error('S3 不允许该方法');
  assertStorageKey(key);
  const url = new URL(`/${config.bucket}/${key}`, config.endpoint);
  const stamp = new Date(now).toISOString().replace(/[-:]|\.\d{3}/g, '');
  const date = stamp.slice(0, 8);
  const signed = {
    ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')])),
    host: url.host,
    'x-amz-content-sha256': sha256(body),
    'x-amz-date': stamp,
  };
  const names = Object.keys(signed).sort();
  const scope = `${date}/${config.region}/s3/aws4_request`;
  const canonical = [method, url.pathname, '', names.map(name => `${name}:${signed[name]}\n`).join(''), names.join(';'), sha256(body)].join('\n');
  const text = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.secretKey}`, date), config.region), 's3'), 'aws4_request');
  signed.authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${hmac(signingKey, text).toString('hex')}`;
  return { url: url.href, headers: signed };
}

/** 超时覆盖响应头和响应体，最多读取上限字节；绝不跟随重定向或记录上游错误原文。 */
export async function boundedRequest(url, init, {
  fetch = globalThis.fetch, timeoutMs = 15000, maxBytes = MAX_BYTES,
} = {}) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, { ...init, redirect: 'manual', signal: controller.signal });
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          throw new Error('重定向已拒绝');
        }
        const advertised = response.headers.get('content-length');
        if (init.method !== 'HEAD' && advertised !== null && (!/^\d+$/.test(advertised) || Number(advertised) > maxBytes)) {
          await response.body?.cancel();
          throw new Error('响应长度超限或无效');
        }
        const chunks = [];
        let size = 0;
        if (response.body) {
          for await (const chunk of response.body) {
            size += chunk.length;
            if (size > maxBytes) throw new Error('响应长度超限');
            chunks.push(Buffer.from(chunk));
          }
        }
        return { status: response.status, headers: response.headers, body: Buffer.concat(chunks) };
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('请求超时')); }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (['重定向已拒绝', '响应长度超限或无效', '响应长度超限', '请求超时'].includes(error.message)) throw error;
    throw new Error('请求失败或超时');
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function validateConfig(config, allowLoopbackForTests) {
  if (!config || typeof config.accessKey !== 'string' || !config.accessKey || typeof config.secretKey !== 'string' || !config.secretKey
    || /[\s:\x00-\x1f\x7f]/.test(config.accessKey) || /[\x00-\x1f\x7f]/.test(config.secretKey)) throw new Error('须提供完整且合法 S3 凭据');
  const url = new URL(config.endpoint);
  const local = allowLoopbackForTests && url.protocol === 'http:' && url.hostname === '127.0.0.1';
  if ((config.endpoint !== STATIC_CDN_S3_ENDPOINT && !local) || url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || config.region !== S3_REGION || !S3_BUCKET_RE.test(config.bucket ?? '') || config.forcePathStyle !== true) {
    throw new Error('S3 目的地不在合同允许范围');
  }
}

export function createS3Storage(config, {
  fetch = globalThis.fetch, timeoutMs = 15000, attempts = 3, backoff = 300, now = () => Date.now(), allowLoopbackForTests = false,
} = {}) {
  validateConfig(config, allowLoopbackForTests);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 3 || !Number.isFinite(backoff) || backoff < 0 || backoff > 5000
    || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) throw new Error('S3 重试或超时参数超限');
  const locks = new Map();
  const request = async (method, key, { body, headers, retry = true } = {}) => {
    assertStorageKey(key);
    const limit = retry ? attempts : 1;
    for (let attempt = 1; ; attempt += 1) {
      const signed = signS3Request(config, method, key, { body, headers, now: now() });
      let result;
      try {
        const requestTimeout = method === 'PUT' && body ? uploadTimeoutMs(timeoutMs, body.length) : timeoutMs;
        result = await boundedRequest(signed.url, { method, headers: signed.headers, ...(body ? { body } : {}) }, { fetch, timeoutMs: requestTimeout });
      } catch (error) {
        // 泄漏保护：不回显可能含凭据的 fetch 异常或响应体。
        if (error.message.includes('重定向') || error.message.includes('长度')) throw new Error(`S3 ${method} ${key}：${error.message}`);
        if (attempt >= limit) throw new Error(`S3 ${method} ${key}：请求失败或超时`);
      }
      if (result && result.status !== 429 && result.status < 500) return result;
      if (attempt >= limit) throw new Error(`S3 ${method} ${key}：HTTP ${result?.status ?? 'network'}`);
      await sleep(backoff * attempt);
    }
  };
  const ensureUnlocked = async (key, body, mime) => {
    assertObjectContent(key, body, mime);
    for (let attempt = 1; ; attempt += 1) {
      const current = await request('GET', key);
      if (current.status === 200) {
        if (!current.body.equals(body)) throw new Error(`${key}：SHA-256 / 字节冲突，拒绝覆盖`);
        return 'exists';
      }
      if (current.status !== 404) throw new Error(`S3 GET ${key}：HTTP ${current.status}`);
      try {
        const result = await request('PUT', key, {
          body, retry: false,
          headers: { 'content-type': mime, 'cache-control': 'public, max-age=31536000, immutable', 'x-amz-meta-sha256': sha256(body) },
        });
        if (result.status !== 200) throw Object.assign(new Error(`S3 PUT ${key}：HTTP ${result.status}`), { permanent: result.status !== 429 && result.status < 500 });
        const saved = await request('GET', key);
        if (saved.status !== 200 || !saved.body.equals(body)) throw Object.assign(new Error(`${key}：写后 SHA-256 / 字节不一致`), { permanent: true });
        return 'stored';
      } catch (error) {
        if (error.permanent || /重定向|长度|冲突/.test(error.message) || attempt >= attempts) throw error;
        // PUT 超时可能已经落地：重试从完整 GET 开始，禁止盲目重发 PUT。
        await sleep(backoff * attempt);
      }
    }
  };
  return {
    config,
    request(method, key) {
      if (!['GET', 'HEAD'].includes(method)) throw new Error('仅允许读取，写入必须经过 ensure');
      return request(method, key);
    },
    ensure(key, body, mime) {
      assertStorageKey(key);
      const previous = locks.get(key) ?? Promise.resolve();
      const result = previous.catch(() => {}).then(() => ensureUnlocked(key, body, mime));
      locks.set(key, result);
      result.finally(() => { if (locks.get(key) === result) locks.delete(key); }).catch(() => {});
      return result;
    },
  };
}
