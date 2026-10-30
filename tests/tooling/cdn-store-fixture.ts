import { createHash, createHmac } from 'node:crypto';
import { createServer, request, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Duplex, Readable } from 'node:stream';

export const fixtureKeys = { accessKey: 'fixture-access', secretKey: 'fixture-secret' };
export const fixtureEnv = {
  STATIC_CDN_S3_ACCESS_KEY_ID: fixtureKeys.accessKey,
  STATIC_CDN_S3_SECRET_ACCESS_KEY: fixtureKeys.secretKey,
  STATIC_CDN_S3_BUCKET: 'fixture-bucket',
};
export type StoredObject = { body: Buffer; type: string };
export type StoreFault = {
  readStatus?: number; putStatus?: number; busy?: number; lostPut?: boolean;
  headStatus?: number; headLength?: number; acao?: string | null; type?: string; length?: number;
  body?: Buffer; rangeBody?: Buffer; rangeStatus?: number; contentRange?: string;
  redirect?: string; delayMs?: number; hangBody?: boolean;
  cacheControl?: string; rangeType?: string; rangeAcao?: string; busyStatus?: number;
};

// 独立验证 HTTP 上的 SigV4，不调用被测签名器；服务端故意允许覆盖，证明防覆盖在客户端执行。
function authentic(req: IncomingMessage, body: Buffer): boolean {
  const auth = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/([^,]+), SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/.exec(String(req.headers.authorization));
  if (!auth || auth[1] !== fixtureKeys.accessKey) return false;
  const [date, region, service, terminal] = auth[2].split('/');
  if (region !== 'cn-south-1' || service !== 's3' || terminal !== 'aws4_request') return false;
  const stamp = String(req.headers['x-amz-date']);
  if (!stamp.startsWith(date)) return false;
  const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
  if (req.headers['x-amz-content-sha256'] !== hash(body)) return false;
  const names = auth[3].split(';');
  if (!names.includes('host') || !names.includes('x-amz-date') || !names.includes('x-amz-content-sha256')) return false;
  const headers = names.map(name => `${name}:${String(req.headers[name] ?? '').trim().replace(/\s+/g, ' ')}\n`).join('');
  const canonical = [req.method, req.url, '', headers, auth[3], hash(body)].join('\n');
  const text = ['AWS4-HMAC-SHA256', stamp, auth[2], hash(canonical)].join('\n');
  const hmac = (key: Buffer | string, value: string) => createHmac('sha256', key).update(value).digest();
  const key = hmac(hmac(hmac(hmac(`AWS4${fixtureKeys.secretKey}`, date), region), service), terminal);
  return hmac(key, text).toString('hex') === auth[4];
}

export async function startCdnStore(fault: StoreFault = {}) {
  const objects = new Map<string, StoredObject>();
  const calls: { method: string; key: string; signed: boolean; headers: IncomingMessage['headers'] }[] = [];
  let active = 0;
  let maxActive = 0;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const signed = Boolean(req.headers.authorization);
    // S3 请求是 path-style：/fixture-bucket/<键>，必须签名（GET/HEAD 不签也放行，和旧假存储一致）；公开读走域名，路径是 /<键>，不签名。
    const bucketPath = req.url!.startsWith('/fixture-bucket/');
    const publicRead = !signed && !bucketPath && req.url!.startsWith('/yzgc/');
    const key = bucketPath ? req.url!.slice('/fixture-bucket/'.length) : req.url!.slice(1);
    calls.push({ method: req.method!, key, signed, headers: req.headers });
    if ((!bucketPath && !publicRead) || (signed && !authentic(req, body))) {
      res.writeHead(403).end(); return;
    }
    if (fault.redirect) { res.writeHead(307, { location: fault.redirect }).end(); return; }
    active += 1; maxActive = Math.max(maxActive, active);
    res.once('close', () => { active -= 1; });
    if (fault.delayMs) await new Promise(resolve => setTimeout(resolve, fault.delayMs));
    if (fault.busy && fault.busy-- > 0) { res.writeHead(fault.busyStatus ?? 429, { 'retry-after': '0' }).end('fixture-busy'); return; }
    if (req.method === 'PUT') {
      if (!signed) { res.writeHead(403).end(); return; }
      if (fault.putStatus) { res.writeHead(fault.putStatus).end('fixture-secret-not-for-logs'); return; }
      objects.set(key, { body, type: String(req.headers['content-type']) });
      if (fault.lostPut) { fault.lostPut = false; req.socket.destroy(); return; }
      res.writeHead(200, { etag: '"opaque-multipart-etag-7"' }).end(); return;
    }
    if (!['HEAD', 'GET'].includes(req.method!)) { res.writeHead(405).end(); return; }
    if (fault.readStatus) { res.writeHead(fault.readStatus).end(); return; }
    const stored = objects.get(key);
    if (!stored) { res.writeHead(404).end(); return; }
    const value = fault.body ?? stored.body;
    const headers: Record<string, string> = {
      'content-type': fault.type ?? stored.type,
      'content-length': String(fault.length ?? value.length),
      'accept-ranges': 'bytes',
      'cache-control': fault.cacheControl ?? 'public, max-age=31536000, immutable',
      etag: '"opaque-multipart-etag-7"',
    };
    if (fault.acao !== null) headers['access-control-allow-origin'] = fault.acao ?? '*';
    if (req.method === 'HEAD') {
      if (fault.headLength !== undefined) headers['content-length'] = String(fault.headLength);
      res.writeHead(fault.headStatus ?? 200, headers).end(); return;
    }
    if (req.headers.range) {
      if (fault.rangeType) headers['content-type'] = fault.rangeType;
      if (fault.rangeAcao) headers['access-control-allow-origin'] = fault.rangeAcao;
      const last = Math.min(31, value.length - 1);
      const range = fault.rangeBody ?? value.subarray(0, last + 1);
      headers['content-range'] = fault.contentRange ?? `bytes 0-${last}/${value.length}`;
      headers['content-length'] = String(range.length);
      res.writeHead(fault.rangeStatus ?? 206, headers).end(range); return;
    }
    res.writeHead(200, headers);
    if (fault.hangBody) { res.flushHeaders(); res.write(value.subarray(0, 1)); return; }
    res.end(value);
  });
  // 受限执行器不能 listen。默认仍通过真正的 Node HTTP client/server 解析字节，
  // 只把 TCP 换成进程内双向流；父级可用 CDN_TEST_TCP=1 原样执行绑定端口的回归。
  const tcp = process.env.CDN_TEST_TCP === '1';
  if (tcp) await new Promise<void>((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const endpoint = tcp ? `http://127.0.0.1:${(server.address() as AddressInfo).port}` : 'http://127.0.0.1:19095';
  const sockets = new Set<Duplex>();
  const httpFetch: typeof fetch = tcp ? fetch : async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.origin !== endpoint) throw new Error('fixture refuses external network');
    let client: Duplex;
    let peer: Duplex;
    const side = (other: () => Duplex) => new Duplex({
      read() {},
      write(chunk, _encoding, callback) { other().push(chunk); callback(); },
      final(callback) { other().push(null); callback(); },
    });
    client = side(() => peer); peer = side(() => client);
    for (const socket of [client, peer]) {
      sockets.add(socket); socket.once('close', () => sockets.delete(socket));
      // Node HTTP 只需要这些 socket hint；字节处理仍走原生 HTTP parser。
      Object.assign(socket, { setNoDelay() {}, setKeepAlive() {}, setTimeout() {} });
    }
    server.emit('connection', peer);
    return new Promise<Response>((resolve, reject) => {
      const req = request({
        hostname: url.hostname, port: url.port, path: url.pathname + url.search,
        method: init.method ?? 'GET', headers: Object.fromEntries(new Headers(init.headers)),
        createConnection: () => client as never, agent: undefined, signal: init.signal ?? undefined,
      }, res => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(res.headers)) if (value !== undefined) headers.set(name, String(value));
        res.once('end', () => { client.destroy(); peer.destroy(); });
        resolve(new Response(init.method === 'HEAD' ? null : Readable.toWeb(res) as never, { status: res.statusCode, headers }));
      });
      req.once('error', error => { client.destroy(); peer.destroy(); reject(error); });
      req.end(init.body ?? undefined);
    });
  };
  return {
    objects, calls, fault, endpoint, fetch: httpFetch,
    config: { ...fixtureKeys, endpoint, bucket: 'fixture-bucket', region: 'cn-south-1', forcePathStyle: true },
    get maxActive() { return maxActive; },
    async close() {
      for (const socket of sockets) socket.destroy();
      if (!tcp) return;
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
