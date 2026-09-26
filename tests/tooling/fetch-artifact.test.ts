import { describe, expect, it } from 'vitest';
import { fetchArtifact, parseArgs, ranges } from '../../scripts/fetch-artifact.mjs';

const REPO = 'Yangtze-University-Geek-Class/admin';
const NAME = 'yzgc-images-preview-a1b2c3d4e5f6';
const options = { repo: REPO, run: '42', name: NAME, dir: '/tmp/bundle', parts: 4 };

/** 假的 GitHub API 与存储：artifact 内容是 payload，下载地址每取一次换一个；failFirst 里的段第一次返回 500。 */
function fakeGitHub(payload: Buffer, { failFirst = new Set<string>(), size = payload.length } = {}) {
  const calls: string[] = [];
  let issued = 0;
  const failed = new Set<string>();
  const fetchImpl = async (url: string, init: { headers?: Record<string, string>; redirect?: string } = {}) => {
    calls.push(url);
    if (url.includes('/actions/runs/42/artifacts')) {
      expect(init.headers?.authorization).toBe('Bearer t0ken');
      return Response.json({ artifacts: [{ id: 7, name: NAME, size_in_bytes: size, expired: false }, { id: 8, name: 'other', size_in_bytes: 1, expired: false }] });
    }
    if (url.endsWith('/actions/artifacts/7/zip')) {
      expect(init.redirect).toBe('manual');
      issued += 1;
      return new Response(null, { status: 302, headers: { location: `https://blob.test/zip?sig=${issued}` } });
    }
    if (url.startsWith('https://blob.test/')) {
      expect(init.headers?.authorization).toBeUndefined();
      const range = init.headers?.range ?? '';
      const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(range) ?? [];
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

function deps(fetchImpl: unknown) {
  const typedFetch = fetchImpl as typeof fetch;
  const file = { bytes: Buffer.alloc(0), closed: false, removed: false, unzipped: false };
  return {
    file,
    deps: {
      fetchImpl: typedFetch,
      open: () => 3,
      write: (_fd: number, bytes: Buffer, position: number) => {
        const next = Buffer.alloc(Math.max(file.bytes.length, position + bytes.length));
        file.bytes.copy(next);
        bytes.copy(next, position);
        file.bytes = next;
      },
      close: () => { file.closed = true; },
      unzip: () => { file.unzipped = true; },
      mkdir: () => {},
      remove: () => { file.removed = true; },
      log: () => {},
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

  it('fails without unzipping when the bytes received do not add up to the artifact size', async () => {
    const gh = fakeGitHub(Buffer.from('0123456789'), { size: 12 });
    const { file, deps: d } = deps(gh.fetchImpl);
    await expect(fetchArtifact(options, 't0ken', d)).rejects.toThrow(/收到|字节/);
    expect(file.unzipped).toBe(false);
    expect(file.removed).toBe(true);
  });

  it('refuses to run without a token and rejects malformed arguments', async () => {
    await expect(fetchArtifact(options, '', deps(async () => new Response()).deps)).rejects.toThrow(/GH_TOKEN/);
    expect(parseArgs(['--repo', REPO, '--run', '42', '--name', NAME, '--dir', '/tmp/b'])).toMatchObject({ parts: 16 });
    expect(() => parseArgs(['--repo', 'nope', '--run', '42', '--name', NAME, '--dir', '/tmp/b'])).toThrow(/owner\/repo/);
    expect(() => parseArgs(['--repo', REPO, '--run', 'x', '--name', NAME, '--dir', '/tmp/b'])).toThrow(/运行 ID/);
    expect(() => parseArgs(['--repo', REPO, '--run', '42', '--name', NAME])).toThrow(/--dir/);
    expect(() => parseArgs(['--token', 'x'])).toThrow(/不认识/);
  });
});
