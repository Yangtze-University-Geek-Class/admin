import { createHash, createHmac } from "node:crypto";

/**
 * 用户文件的对象存储（#352）：头像与论坛图片写到七牛的 S3 兼容端点，path-style 与 SigV4，服务 `s3`。
 * 只用 fetch 与 node:crypto，不加依赖。桶是公开读的：读取走公开地址、不签名；写入与探测存在才签名。
 * 端点、区域、桶、前缀与公开地址全部来自环境（lib 之外的 config.ts 解析），这里不写死任何一个。
 * 对象键只允许 `A-Za-z0-9._-` 与 `/`，不含 `..`，都是 RFC 3986 的非保留字符，所以路径不需要再做百分号编码。
 */

export type ObjectStorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** 桶内的目录前缀，以 / 结尾，例如 `yzgc/preview/`；预发布与正式各用各的。 */
  prefix: string;
  /** 公开地址的基址，以 / 结尾；公开地址 = 基址 + 前缀 + 对象键（域名绑定到桶，地址里没有桶名）。 */
  publicBase: string;
};

export type ObjectFetch = (url: string, init: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 15_000;
// 比赛官网的站点文件名保留原样（Vite 产物带大写字母与下划线），最长 14 + 36 + 200 个字符，留足余量。
const KEY_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._/-]{0,399}$/;
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** 头像的对象键：账号头像与论坛头像内容相同时同一个键（按内容寻址，两边都是 WebP）。 */
export const avatarKey = (hash: string) => `avatars/${hash}.webp`;
/** 论坛上传的图片：gif 保持动图，其余都是 WebP（routes/forum-api/uploads.ts 的 processUpload）。 */
export const uploadKey = (hash: string, mime: string) => `uploads/${hash}.${mime === "image/gif" ? "gif" : "webp"}`;

/** 内容哈希的写法（64 位小写十六进制）：路由在拼对象键前先按它挡住别的字符串。 */
export const isContentHash = (value: string) => /^[0-9a-f]{64}$/.test(value);

/** 只接受不带路径、尾斜杠、查询与凭据的 https 源（逐字比较，不做任何改写）。 */
export function isHttpsOrigin(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "https:" && url.origin === text;
  } catch {
    return false;
  }
}

const sha256Hex = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, text: string) => createHmac("sha256", key).update(text).digest();

/**
 * SigV4 的 Authorization 头（不带查询串的请求）。headers 的键必须是小写，且不包含 authorization。
 * 时间戳格式 `YYYYMMDD'T'HHMMSS'Z'`，签名的日期取它的前 8 位。
 */
export function signV4(input: {
  method: string; url: URL; headers: Record<string, string>; payloadSha256: string; amzDate: string;
  region: string; service?: string; accessKeyId: string; secretAccessKey: string;
}): string {
  if (input.url.search) throw new Error("签名的请求不带查询串");
  const names = Object.keys(input.headers).sort();
  const canonicalHeaders = names.map(name => `${name}:${input.headers[name].trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [input.method, input.url.pathname, "", canonicalHeaders, signedHeaders, input.payloadSha256].join("\n");
  const date = input.amzDate.slice(0, 8);
  const scope = `${date}/${input.region}/${input.service ?? "s3"}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", input.amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${input.secretAccessKey}`, date);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service ?? "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = hmac(kSigning, stringToSign).toString("hex");
  return `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

/**
 * 对象存储客户端。config 为 null 时整体关闭：`enabled` 为 false，写入与公开地址都抛错，调用方先看 `enabled` 再用。
 * `fetch`、`now` 给测试换掉网络与时钟。错误信息只带状态码，不带上游响应体、签名或凭据。
 */
export function createObjectStorage(config: ObjectStorageConfig | null, deps: { fetch?: ObjectFetch; now?: () => Date } = {}) {
  const doFetch: ObjectFetch = deps.fetch ?? ((url, init) => fetch(url, init));
  const now = deps.now ?? (() => new Date());
  const enabled = config !== null;
  const open = (): ObjectStorageConfig => {
    if (!config) throw new Error("对象存储没有开启");
    return config;
  };
  const checkedKey = (key: string): string => {
    if (!KEY_PATTERN.test(key) || key.includes("..")) throw new Error("对象键不合法");
    return key;
  };

  /** 公开地址：公开基址 + 前缀 + 对象键。 */
  function publicUrl(key: string): string {
    const config = open();
    return `${config.publicBase}${config.prefix}${checkedKey(key)}`;
  }

  async function request(method: "HEAD" | "PUT" | "DELETE", key: string, body: Buffer | null, contentType: string | null): Promise<Response> {
    const config = open();
    // path-style：端点 / 桶 / 前缀 + 对象键；前缀与对象键都只含签名不需要编码的字符。
    const url = new URL(`${config.endpoint}/${config.bucket}/${config.prefix}${checkedKey(key)}`);
    const payloadSha256 = body ? sha256Hex(body) : EMPTY_SHA256;
    const amzDate = now().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadSha256, "x-amz-date": amzDate };
    if (contentType) headers["content-type"] = contentType;
    headers.authorization = signV4({
      method, url, headers, payloadSha256, amzDate, region: config.region,
      accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey,
    });
    // Buffer 视图直接交给 fetch，不复制一份。
    const payload = (body ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength) : undefined) as RequestInit["body"];
    return doFetch(url.href, { method, headers, body: payload, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
  }

  /** 对象是否已经在桶里（HEAD）：200 为有，404 为没有，别的状态抛错，不猜。 */
  async function exists(key: string): Promise<boolean> {
    const response = await request("HEAD", key, null, null);
    await response.arrayBuffer().catch(() => undefined);
    if (response.status === 200) return true;
    if (response.status === 404) return false;
    throw new Error(`对象存储 HEAD 失败（HTTP ${response.status}）`);
  }

  /** 写入一个对象，返回公开地址。 */
  async function put(key: string, body: Buffer, contentType: string): Promise<string> {
    const response = await request("PUT", key, body, contentType);
    await response.arrayBuffer().catch(() => undefined);
    if (!response.ok) throw new Error(`对象存储 PUT 失败（HTTP ${response.status}）`);
    return publicUrl(key);
  }

  /** 删除一个对象：200、204 与 404 都算删掉了（重复删、本来就没有都无所谓）；别的状态抛错。 */
  async function remove(key: string): Promise<void> {
    const response = await request("DELETE", key, null, null);
    await response.arrayBuffer().catch(() => undefined);
    if (response.ok || response.status === 404) return;
    throw new Error(`对象存储 DELETE 失败（HTTP ${response.status}）`);
  }

  /** 公开地址的前缀（基址 + 桶内前缀，以 / 结尾）；没开启时为 null。比赛官网的 CSP 与重定向都从这里取。 */
  function publicPrefix(): string | null {
    return config ? `${config.publicBase}${config.prefix}` : null;
  }

  /** 先 HEAD，没有才 PUT：内容寻址的对象重复上传、回填重跑都不会再传一遍。 */
  async function ensure(key: string, body: Buffer, contentType: string): Promise<string> {
    if (!(await exists(key))) await put(key, body, contentType);
    return publicUrl(key);
  }

  /** 公开读取（不签名）：非 200、超过 maxBytes 都返回 null。 */
  async function readPublic(key: string, maxBytes: number): Promise<Buffer | null> {
    const response = await doFetch(publicUrl(key), { method: "GET", redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) {
      await response.arrayBuffer().catch(() => undefined);
      return null;
    }
    const data = Buffer.from(await response.arrayBuffer());
    return data.length <= maxBytes ? data : null;
  }

  return { enabled, publicUrl, publicPrefix, exists, put, ensure, remove, readPublic };
}
export type ObjectStorage = ReturnType<typeof createObjectStorage>;
