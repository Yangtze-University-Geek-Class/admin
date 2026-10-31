import { createHmac, hkdfSync } from "node:crypto";
import { BlockList, isIP } from "node:net";
import type Database from "better-sqlite3";
import type { createCrypto } from "./crypto.js";

const RUNTIME_KEY = "security_runtime_policy";
const DEFAULT_STRICT_THRESHOLD = 20;
const DEFAULT_STRICT_WINDOW_SECONDS = 15;
const MAX_NOTE = 160;
// 一条白名单最多放行多大的网段：IPv4 一个 /16，IPv6 一个站点 /48。再大就等于对一大片来源关掉防护，写错一位就是全站放行。
const MIN_PREFIX = { 4: 16, 6: 48 } as const;
// ::ffff:0:0/96 是 IPv4 映射地址：Node 的 BlockList 拿它去比 IPv4 来源，所以这一段按 IPv4 存，盖住整段的 IPv6 网段直接拒绝。
const MAPPED_START = 0xffffn << 32n;
const MAPPED_END = MAPPED_START + 0xffffffffn;

type Crypto = ReturnType<typeof createCrypto>;
type ByteIp = { family: 4 | 6; bytes: Uint8Array };
export type NormalizedCidr = { canonical: string; family: 4 | 6; prefix: number; start: bigint; end: bigint; bits: number };
export type SecurityRuntimePolicy = {
  strict_mode: boolean;
  strict_threshold: number;
  strict_window_seconds: number;
  version: number;
};
export type SecurityPolicyView = SecurityRuntimePolicy & {
  shield_enabled: boolean;
  allowlist_count: number;
};
export type SecurityAllowlistEntry = {
  id: number;
  cidr: string;
  note: string;
  enabled: boolean;
  created_by: string | null;
  created_at: number;
  updated_at: number;
};

type Row = {
  id: number;
  cidr_hash: string;
  cidr_encrypted: string;
  note: string;
  enabled: number;
  created_by: string | null;
  created_at: number;
  updated_at: number;
};

type RuntimeRow = { value: string };
/** 列表里解不开的那一行显示成这个，管理员能看到并删掉。 */
const UNREADABLE = "无法读取";

function fail(message: string, code = "invalid_security_policy"): never {
  throw Object.assign(new Error(message), { statusCode: 400, code });
}

function parseIpv4(value: string): ByteIp {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) fail("IP 地址格式不对", "bad_ip");
  return { family: 4, bytes: Uint8Array.from(parts.map(Number)) };
}

function parseIpv6(value: string): ByteIp {
  let address = value.toLowerCase();
  const embedded = address.lastIndexOf(":");
  if (address.includes(".") && embedded >= 0) {
    const v4 = parseIpv4(address.slice(embedded + 1));
    address = `${address.slice(0, embedded)}:${((v4.bytes[0]! << 8) | v4.bytes[1]!).toString(16)}:${((v4.bytes[2]! << 8) | v4.bytes[3]!).toString(16)}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) fail("IPv6 地址格式不对", "bad_ip");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if ([...left, ...right].some(part => !/^[0-9a-f]{1,4}$/.test(part))) fail("IPv6 地址格式不对", "bad_ip");
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) fail("IPv6 地址格式不对", "bad_ip");
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right].map(part => Number.parseInt(part, 16));
  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => { bytes[index * 2] = group >>> 8; bytes[index * 2 + 1] = group & 0xff; });
  return { family: 6, bytes };
}

function toBytes(address: string): ByteIp {
  const family = isIP(address);
  if (family === 4) return parseIpv4(address);
  if (family === 6) return parseIpv6(address);
  fail("IP 地址格式不对", "bad_ip");
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  return [...bytes].reduce((value, byte) => (value << 8n) | BigInt(byte), 0n);
}

function bigIntToBytes(value: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let index = length - 1; index >= 0; index -= 1) { bytes[index] = Number(value & 0xffn); value >>= 8n; }
  return bytes;
}

function addressString(ip: ByteIp): string {
  if (ip.family === 4) return [...ip.bytes].join(".");
  const groups: string[] = [];
  for (let index = 0; index < 16; index += 2) groups.push(((ip.bytes[index]! << 8) | ip.bytes[index + 1]!).toString(16));
  // 压缩写法（RFC 5952，和 WHATWG URL 的序列化一致）：去重哈希按它算，同一个网段只有一种写法。
  return new URL(`http://[${groups.join(":")}]`).hostname.slice(1, -1);
}

export function normalizeCidr(value: string): NormalizedCidr {
  const raw = value.trim();
  const [address, prefixText, ...rest] = raw.split("/");
  if (!address || rest.length > 0 || (prefixText !== undefined && !/^\d{1,3}$/.test(prefixText))) fail("请输入 IP 或 CIDR 网段", "bad_cidr");
  const ip = toBytes(address);
  const bits = ip.family === 4 ? 32 : 128;
  const prefix = prefixText === undefined ? bits : Number(prefixText);
  if (prefix < 0 || prefix > bits) fail("CIDR 前缀长度超出范围", "bad_cidr");
  const valueInt = bytesToBigInt(ip.bytes);
  if (ip.family === 6 && prefix >= 96 && (valueInt & ~0xffffffffn) === MAPPED_START) {
    return normalizeCidr(`${addressString({ family: 4, bytes: ip.bytes.slice(12) })}/${prefix - 96}`);
  }
  if (prefix < MIN_PREFIX[ip.family]) fail(`网段太大：IPv4 最大到 /${MIN_PREFIX[4]}，IPv6 最大到 /${MIN_PREFIX[6]}`, "cidr_too_broad");
  const hostBits = BigInt(bits - prefix);
  const mask = ((1n << BigInt(bits)) - 1n) ^ ((1n << hostBits) - 1n);
  if ((valueInt & ~mask) !== 0n) fail("主机位不为 0：网段请写网络地址，例如 203.0.113.0/24", "bad_cidr");
  const start = valueInt;
  const end = start + ((1n << hostBits) - 1n);
  if (ip.family === 6 && start <= MAPPED_END && MAPPED_START <= end) fail("这个 IPv6 网段包含 IPv4 映射地址，请直接写 IPv4 网段", "cidr_too_broad");
  const network = { family: ip.family, bytes: bigIntToBytes(start, ip.family === 4 ? 4 : 16) } as ByteIp;
  return { canonical: `${addressString(network)}/${prefix}`, family: ip.family, prefix, start, end, bits };
}

function overlaps(a: NormalizedCidr, b: NormalizedCidr): boolean {
  return a.family === b.family && a.start <= b.end && b.start <= a.end;
}

export function createSecurityPolicy(db: Database.Database, deps: { crypto: Crypto; secret: string; shieldEnabled: boolean; baseAllowlist: BlockList; clock?: () => number }) {
  const clock = deps.clock ?? Date.now;
  let cachedRuntime: SecurityRuntimePolicy | null = null;
  let cachedRuntimeCiphertext: string | undefined;
  let cachedAllowlist: BlockList | null = null;
  // 去重哈希用从 SESSION_SECRET 派生的子密钥，不直接拿签 cookie 的那把（同 email-login.ts 的做法）
  const hashKey = Buffer.from(hkdfSync("sha256", deps.secret, "", "yzgc:security-allowlist:v1", 32));
  // 解不开或不再合规的一行（换过 ENCRYPTION_KEY、跨环境恢复了备份、手工改库）当作不存在：不放行，也不让每个请求都抛错
  const readable = (row: Row): NormalizedCidr | null => {
    try { return normalizeCidr(deps.crypto.decrypt(row.cidr_encrypted)); } catch { return null; }
  };
  const loadRuntime = (): SecurityRuntimePolicy => {
    const row = db.prepare<[string], RuntimeRow>("SELECT value FROM app_state WHERE key=?").get(RUNTIME_KEY);
    if (!row) return { strict_mode: false, strict_threshold: DEFAULT_STRICT_THRESHOLD, strict_window_seconds: DEFAULT_STRICT_WINDOW_SECONDS, version: 0 };
    if (row.value === cachedRuntimeCiphertext && cachedRuntime) return cachedRuntime;
    try {
      const parsed = JSON.parse(deps.crypto.decrypt(row.value)) as Partial<SecurityRuntimePolicy>;
      const strictMode = parsed.strict_mode;
      const strictThreshold = parsed.strict_threshold;
      const strictWindowSeconds = parsed.strict_window_seconds;
      const version = parsed.version;
      if (typeof strictMode !== "boolean" || typeof strictThreshold !== "number" || !Number.isSafeInteger(strictThreshold) || strictThreshold < 1 || strictThreshold > 1000 || typeof strictWindowSeconds !== "number" || !Number.isSafeInteger(strictWindowSeconds) || strictWindowSeconds < 1 || strictWindowSeconds > 60 || typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) throw new Error("invalid runtime policy");
      const next = { strict_mode: strictMode, strict_threshold: strictThreshold, strict_window_seconds: strictWindowSeconds, version };
      cachedRuntime = next;
      cachedRuntimeCiphertext = row.value;
      return next;
    } catch {
      cachedRuntime = { strict_mode: false, strict_threshold: DEFAULT_STRICT_THRESHOLD, strict_window_seconds: DEFAULT_STRICT_WINDOW_SECONDS, version: 0 };
      cachedRuntimeCiphertext = row.value;
      return cachedRuntime;
    }
  };
  const rows = () => db.prepare<[], Row>("SELECT id,cidr_hash,cidr_encrypted,note,enabled,created_by,created_at,updated_at FROM security_ip_allowlist ORDER BY id DESC").all();
  const rebuild = () => {
    const list = new BlockList();
    for (const row of rows()) {
      const normalized = row.enabled ? readable(row) : null;
      if (!normalized) continue;
      list.addSubnet(addressString({ family: normalized.family, bytes: bigIntToBytes(normalized.start, normalized.family === 4 ? 4 : 16) }), normalized.prefix, normalized.family === 4 ? "ipv4" : "ipv6");
    }
    cachedAllowlist = list;
    return list;
  };
  const dynamicAllowlist = () => cachedAllowlist ?? rebuild();
  const allowlisted = (ip: string) => {
    const family = isIP(ip);
    if (family === 0) return false;
    return deps.baseAllowlist.check(ip, family === 4 ? "ipv4" : "ipv6") || dynamicAllowlist().check(ip, family === 4 ? "ipv4" : "ipv6");
  };
  const get = (): SecurityPolicyView => {
    const runtime = loadRuntime();
    return { ...runtime, shield_enabled: deps.shieldEnabled, allowlist_count: rows().filter(row => row.enabled && readable(row)).length };
  };
  const viewOf = (runtime: SecurityRuntimePolicy): SecurityPolicyView => ({ ...runtime, shield_enabled: deps.shieldEnabled, allowlist_count: rows().filter(row => row.enabled && readable(row)).length });
  const writeRuntime = (runtime: SecurityRuntimePolicy) => {
    const encrypted = deps.crypto.encrypt(JSON.stringify(runtime));
    db.prepare("INSERT INTO app_state(key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(RUNTIME_KEY, encrypted, clock());
    cachedRuntime = null;
    cachedRuntimeCiphertext = undefined;
  };
  const setRuntime = (input: { strict_mode: boolean; strict_threshold: number; strict_window_seconds: number; version: number }) => {
    const current = loadRuntime();
    if (input.version !== current.version) throw Object.assign(new Error("安全策略已被其他管理员更新，请刷新后重试"), { statusCode: 409, code: "security_policy_conflict" });
    if (!deps.shieldEnabled && input.strict_mode) throw Object.assign(new Error("基础防护关闭时不能开启严格模式"), { statusCode: 409, code: "shield_disabled" });
    if (!Number.isSafeInteger(input.strict_threshold) || input.strict_threshold < 1 || input.strict_threshold > 1000 || !Number.isSafeInteger(input.strict_window_seconds) || input.strict_window_seconds < 1 || input.strict_window_seconds > 60) fail("严格防护参数不在允许范围内");
    const next = { strict_mode: input.strict_mode, strict_threshold: input.strict_threshold, strict_window_seconds: input.strict_window_seconds, version: current.version + 1 };
    writeRuntime(next);
    return viewOf(next);
  };
  const list = (): SecurityAllowlistEntry[] => rows().map(row => ({ id: row.id, cidr: readable(row)?.canonical ?? UNREADABLE, note: row.note, enabled: Boolean(row.enabled), created_by: row.created_by, created_at: row.created_at, updated_at: row.updated_at }));
  const add = (input: { cidr: string; note: string; createdBy: string; version: number }) => {
    const currentRuntime = loadRuntime();
    if (input.version !== currentRuntime.version) throw Object.assign(new Error("安全策略已被其他管理员更新，请刷新后重试"), { statusCode: 409, code: "security_policy_conflict" });
    const normalized = normalizeCidr(input.cidr);
    const note = input.note.trim();
    if (note.length > MAX_NOTE) fail(`备注不能超过 ${MAX_NOTE} 个字`, "bad_note");
    const current = rows().filter(row => row.enabled).map(readable);
    if (current.some(item => item && overlaps(item, normalized))) throw Object.assign(new Error("这个网段与已有白名单重叠"), { statusCode: 409, code: "allowlist_overlap" });
    const hash = createHmac("sha256", hashKey).update(`security-allowlist-v1:${normalized.canonical}`).digest("hex");
    const now = clock();
    try {
      const result = db.prepare("INSERT INTO security_ip_allowlist(cidr_hash,cidr_encrypted,note,enabled,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run(hash, deps.crypto.encrypt(normalized.canonical), note, 1, input.createdBy, now, now);
      writeRuntime({ ...currentRuntime, version: currentRuntime.version + 1 });
      cachedAllowlist = null;
      return list().find(row => row.id === Number(result.lastInsertRowid))!;
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw Object.assign(new Error("这个网段已经在白名单中"), { statusCode: 409, code: "allowlist_exists" });
      throw error;
    }
  };
  const remove = (id: number, version: number) => {
    if (!Number.isSafeInteger(id) || id < 1) fail("白名单编号不对", "bad_allowlist_id");
    const currentRuntime = loadRuntime();
    if (version !== currentRuntime.version) throw Object.assign(new Error("安全策略已被其他管理员更新，请刷新后重试"), { statusCode: 409, code: "security_policy_conflict" });
    const result = db.prepare("DELETE FROM security_ip_allowlist WHERE id=?").run(id);
    if (!result.changes) throw Object.assign(new Error("白名单不存在"), { statusCode: 404, code: "not_found" });
    writeRuntime({ ...currentRuntime, version: currentRuntime.version + 1 });
    cachedAllowlist = null;
    return currentRuntime.version + 1;
  };
  return { get, runtime: loadRuntime, setRuntime, allowlisted, list, add, remove, rebuild };
}
export type SecurityPolicyService = ReturnType<typeof createSecurityPolicy>;
