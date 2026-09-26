import { describe, expect, it } from 'vitest';
import { fetchArtifact, parseArgs, ranges } from '../../scripts/fetch-artifact.mjs';

const REPO = 'Yangtze-University-Geek-Class/admin';
const NAME = 'yzgc-images-preview-a1b2c3d4e5f6';
const options = { repo: REPO, run: '42', name: NAME, dir: '/tmp/bundle', parts: 4 };

/**
 * 假的 GitHub API 与存储：artifact 内容是 payload，下载地址每取一次换一个；failFirst 里的段第一次返回 500。
 * stallFirst/stallAlways 里的段返回 206 头之后一个字节都不给（TCP 卡住），hangFirst 里的段第一次连响应头都不回；
 * trickleMs 让其余段每隔这么久才给一个字节。取消时都像真的 fetch 一样以 AbortError 结束。
 */
function fakeGitHub(payload: Buffer, { failFirst = new Set<string>(), alwaysFail = new Set<string>(), size = payload.length, artifacts, slowOthersMs = 0, ignoreAbort = false, stallFirst = new Set<string>(), stallAlways = new Set<string>(), hangFirst = new Set<string>(), trickleMs = 0 }: { failFirst?: Set<string>; alwaysFail?: Set<string>; size?: number; artifacts?: unknown[]; slowOthersMs?: number; ignoreAbort?: boolean; stallFirst?: Set<string>; stallAlways?: Set<string>; hangFirst?: Set<string>; trickleMs?: number } = {}) {
  const calls: string[] = [];
  let issued = 0;
  const failed = new Set<string>();
  const stalled = new Set<string>();
  const hung = new Set<string>();
  const fetchImpl = async (url: string, init: { headers?: Record<string, string>; redirect?: string; signal?: AbortSignal } = {}) => {
    if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    calls.push(url);
    if (url.includes('/actions/runs/42/artifacts')) {
      expect(init.headers?.authorization).toBe('Bearer t0ken');
      return Response.json({ artifacts: artifacts ?? [{ id: 7, name: NAME, size_in_bytes: size, expired: false }, { id: 8, name: 'other', size_in_bytes: 1, expired: false }] });
    }
    if (/\/actions\/artifacts\/(7|9)\/zip$/.test(url)) {
      expect(init.redirect).toBe('manual');
      issued += 1;
      return new Response(null, { status: 302, headers: { location: `https://blob.test/zip?sig=${issued}` } });
    }
    if (url.startsWith('https://blob.test/')) {
      expect(init.headers?.authorization).toBeUndefined();
      const range = init.headers?.range ?? '';
      const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(range) ?? [];
      if (alwaysFail.has(range)) return new Response('boom', { status: 500 });
      if (hangFirst.has(range) && !hung.has(range)) {
        hung.add(range);
        return new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
      }
      if (stallAlways.has(range) || (stallFirst.has(range) && !stalled.has(range))) {
        stalled.add(range);
        return new Response(body(new Uint8Array(0), Infinity, init.signal), { status: 206 });
      }
      if (trickleMs) return new Response(body(new Uint8Array(payload.subarray(Number(start), Number(end) + 1)), trickleMs, init.signal), { status: 206 });
      if (slowOthersMs) {
        // 其余段还在传输中：等一会儿，期间被取消就像真的 fetch 一样抛 AbortError
        await new Promise(resolve => setTimeout(resolve, slowOthersMs));
        if (init.signal?.aborted && !ignoreAbort) throw new DOMException('aborted', 'AbortError');
      }
      if (failFirst.has(range) && !failed.has(range)) {
        failed.add(range);
        return new Response('expired', { status: 403 });
      }
      return new Response(new Uint8Array(payload.subarray(Number(start), Number(end) + 1)), { status: 206 });
    }
    throw new Error(`unexpected ${url}`);
  };
  return { fetchImpl, calls, issued: () => issued };
}

/**
 * 每 everyMs 给一个字节的响应体（everyMs 为 Infinity 时永远不给）；signal 取消时以 AbortError 出错。
 * 这里用真实的短计时器：被测的是「多久没收到数据」，流、fetch 与计时器要按真实顺序交错。
 */
function body(bytes: Uint8Array, everyMs: number, signal?: AbortSignal) {
  let offset = 0;
  let stop = () => {};
  return new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener('abort', () => { stop(); controller.error(new DOMException('aborted', 'AbortError')); }, { once: true });
    },
    pull(controller) {
      if (everyMs === Infinity) return new Promise<void>(() => {});
      return new Promise<void>(resolve => {
        const timer = setTimeout(() => {
          controller.enqueue(bytes.subarray(offset, offset + 1));
          offset += 1;
          if (offset >= bytes.length) controller.close();
          resolve();
        }, everyMs);
        stop = () => { clearTimeout(timer); resolve(); };
      });
    },
  });
}

function deps(fetchImpl: unknown) {
  const typedFetch = fetchImpl as typeof fetch;
  const file = { bytes: Buffer.alloc(0), closed: false, removed: false, unzipped: false, writesAfterClose: 0, logs: [] as string[] };
  return {
    file,
    deps: {
      fetchImpl: typedFetch,
      open: () => 3,
      write: (_fd: number, bytes: Buffer, position: number) => {
        if (file.closed) file.writesAfterClose += 1;
        const next = Buffer.alloc(Math.max(file.bytes.length, position + bytes.length));
        file.bytes.copy(next);
        bytes.copy(next, position);
        file.bytes = next;
      },
      close: () => { file.closed = true; },
      unzip: () => { file.unzipped = true; },
      mkdir: () => {},
      remove: () => { file.removed = true; },
      log: (message: string) => { file.logs.push(message); },
      pause: async () => {},
    },
  };
}

describe('fetch-artifact', () => {
  it('splits the artifact into contiguous byte ranges that cover it exactly once', () => {
    expect(ranges(10, 4)).toEqual([[0, 2], [3, 5], [6, 8], [9, 9]]);
    expect(ranges(3, 16)).toEqual([[0, 0], [1, 1], [2, 2]]);
    expect(ranges(162789463, 16).at(-1)?.[1]).toBe(162789462);
  });

  it('downloads the ranges in parallel and reassembles the zip byte for byte before unzipping', async () => {
    const payload = Buffer.from('0123456789abcdefghij');
    const gh = fakeGitHub(payload);
    const { file, deps: d } = deps(gh.fetchImpl);
    await fetchArtifact(options, 't0ken', d);
    expect(file.bytes.equals(payload)).toBe(true);
    expect(file).toMatchObject({ closed: true, unzipped: true, removed: true });
    expect(gh.calls.filter(url => url.startsWith('https://blob.test/'))).toHaveLength(4);
  });

  it('fetches a fresh download URL when a range fails, since the signed URL expires after about a minute', async () => {
    const payload = Buffer.from('0123456789abcdefghij');
    const gh = fakeGitHub(payload, { failFirst: new Set(['bytes=5-9']) });
    const { file, deps: d } = deps(gh.fetchImpl);
    await fetchArtifact(options, 't0ken', d);
    expect(file.bytes.equals(payload)).toBe(true);
    expect(gh.issued()).toBe(5);
  });

  it('fails without unzipping when a range comes back shorter than requested (the blob is smaller than the API says)', async () => {
    const gh = fakeGitHub(Buffer.from('0123456789'), { size: 12 });
    const { file, deps: d } = deps(gh.fetchImpl);
    await expect(fetchArtifact(options, 't0ken', d)).rejects.toThrow(/收到|字节/);
    expect(file.unzipped).toBe(false);
    expect(file.removed).toBe(true);
  });

  it('when one range keeps failing, cancels the others and closes the file only after every range has stopped', async () => {
    const payload = Buffer.alloc(4000, 7);
    const gh = fakeGitHub(payload, { alwaysFail: new Set(['bytes=0-999']), slowOthersMs: 30 });
    const { file, deps: d } = deps(gh.fetchImpl);
    await expect(fetchArtifact(options, 't0ken', d)).rejects.toThrow(/0-999.*5 次/);
    // 其余三段在 0-999 放弃时还没传完：被取消，一个字节都没写；文件在它们停下之后才关
    expect(file.bytes.length).toBe(0);
    expect(file).toMatchObject({ closed: true, unzipped: false, removed: true, writesAfterClose: 0 });
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(file.writesAfterClose).toBe(0);
  });

  it('closes the file only after a range that could not be cancelled has finished writing', async () => {
    // 已经收到数据、取消不了的段：文件要等它写完才关，不能出现关闭后的写入
    const payload = Buffer.alloc(4000, 7);
    const gh = fakeGitHub(payload, { alwaysFail: new Set(['bytes=0-999']), slowOthersMs: 30, ignoreAbort: true });
    const { file, deps: d } = deps(gh.fetchImpl);
    await expect(fetchArtifact(options, 't0ken', d)).rejects.toThrow(/0-999/);
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(file).toMatchObject({ closed: true, removed: true, unzipped: false, writesAfterClose: 0 });
  });

  it('drops a range whose body stalls or whose headers never come, and retries it with a fresh download URL', async () => {
    const payload = Buffer.from('0123456789abcdefghij');
    const gh = fakeGitHub(payload, { stallFirst: new Set(['bytes=5-9']), hangFirst: new Set(['bytes=15-19']) });
    const { file, deps: d } = deps(gh.fetchImpl);
    await fetchArtifact({ ...options, idleMs: 50 }, 't0ken', d);
    expect(file.bytes.equals(payload)).toBe(true);
    expect(file).toMatchObject({ closed: true, unzipped: true, removed: true });
    // 4 段各取一次地址，卡住的两段各再取一次
    expect(gh.issued()).toBe(6);
  }, 3000);

  it('gives up on a range that stalls on every attempt, naming it, and cancels the others instead of waiting for the job timeout', async () => {
    const payload = Buffer.alloc(4000, 7);
    // 其余三段每 20ms 才一个字节，要 20 秒传完：只有被取消才能在测试时限内结束
    const gh = fakeGitHub(payload, { stallAlways: new Set(['bytes=0-999']), trickleMs: 20 });
    const { file, deps: d } = deps(gh.fetchImpl);
    const started = Date.now();
    await expect(fetchArtifact({ ...options, idleMs: 50 }, 't0ken', d)).rejects.toThrow(/0-999.*5 次.*没收到数据/);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(file.bytes.length).toBe(0);
    expect(file).toMatchObject({ closed: true, unzipped: false, removed: true, writesAfterClose: 0 });
  }, 3000);

  it('keeps a slow but steady range: the timeout is for silence, not for the whole range', async () => {
    // 每段 8 字节、每 25ms 一个字节：每段约 200ms，远超 idleMs 的 3 倍，但从没有 50ms 收不到数据
    const payload = Buffer.from('0123456789abcdefghijklmnopqrstuv');
    const gh = fakeGitHub(payload, { trickleMs: 25 });
    const { file, deps: d } = deps(gh.fetchImpl);
    const started = Date.now();
    await fetchArtifact({ ...options, idleMs: 50 }, 't0ken', d);
    expect(Date.now() - started).toBeGreaterThan(150);
    expect(file.bytes.equals(payload)).toBe(true);
    expect(gh.issued()).toBe(4);
  }, 3000);

  it('takes the newest artifact when a rerun left several with the same name, and fails when there is none', async () => {
    const payload = Buffer.from('0123456789');
    const twins = [{ id: 7, name: NAME, size_in_bytes: 10, expired: false }, { id: 9, name: NAME, size_in_bytes: 10, expired: false }, { id: 11, name: NAME, size_in_bytes: 10, expired: true }];
    const gh = fakeGitHub(payload, { artifacts: twins });
    const { file, deps: d } = deps(gh.fetchImpl);
    await fetchArtifact(options, 't0ken', d);
    expect(gh.calls.some(url => url.endsWith('/actions/artifacts/9/zip'))).toBe(true);
    expect(gh.calls.some(url => url.endsWith('/actions/artifacts/7/zip'))).toBe(false);
    expect(file.logs.join('\n')).toMatch(/2 个同名.*9/);
    const none = fakeGitHub(payload, { artifacts: [{ id: 8, name: 'other', size_in_bytes: 1, expired: false }] });
    await expect(fetchArtifact(options, 't0ken', deps(none.fetchImpl).deps)).rejects.toThrow(/没有名为/);
  });

  it('refuses to run without a token and rejects malformed arguments', async () => {
    await expect(fetchArtifact(options, '', deps(async () => new Response()).deps)).rejects.toThrow(/GH_TOKEN/);
    expect(parseArgs(['--repo', REPO, '--run', '42', '--name', NAME, '--dir', '/tmp/b'])).toMatchObject({ parts: 16 });
    expect(() => parseArgs(['--repo', 'nope', '--run', '42', '--name', NAME, '--dir', '/tmp/b'])).toThrow(/owner\/repo/);
    expect(() => parseArgs(['--repo', REPO, '--run', 'x', '--name', NAME, '--dir', '/tmp/b'])).toThrow(/运行 ID/);
    expect(() => parseArgs(['--repo', REPO, '--run', '42', '--name', NAME])).toThrow(/--dir/);
    expect(() => parseArgs(['--token', 'x'])).toThrow(/不认识/);
    const base = ['--repo', REPO, '--run', '42', '--name', NAME, '--dir', '/tmp/b'];
    expect(parseArgs([...base, '--idle-seconds', '90'])).toMatchObject({ idleMs: 90_000 });
    for (const bad of ['0', '-5', '1.5', 'x', '601']) expect(() => parseArgs([...base, '--idle-seconds', bad])).toThrow(/--idle-seconds/);
  });
});
