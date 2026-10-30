import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATIC_CDN_BASE } from '../static-cdn-fixture';
import { useStaticCdnOrigin } from '../static-cdn-hooks';
import {
  LARGE_STICKER_BYTES, MANIFEST_FILE, MAX_STICKER_BYTES, PACK_FILE, STICKER_ASSETS_DIR, STICKER_KEY_PREFIX,
  buildManifest, main, manifestProblem, manifestText, parseArgs, stickerCdnUrl, stickerObjectKey,
} from '../../scripts/sticker-manifest.mjs';
import { FORUM_LIMITS } from '../../app/server/src/lib/forum-rules';
import { loadStickerManifest } from '../../app/server/src/lib/sticker-manifest';

useStaticCdnOrigin();

// 内置表情包的清单（#286）：scripts/sticker-manifest.mjs 从 app/server/assets/stickers/<包>/ 的 pack.json 与图片生成
// manifest.json，服务启动、CDN 上传都读它。这里核对三件事：仓库里的清单与目录一致；清单的生成规则；脚本的命令行。
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/** 过得了校验的假 WebP：RIFF 头加上按名字不同的内容，脚本只看签名、大小和哈希，不解码。 */
function fakeWebp(seed: string, padding = 0): Buffer {
  const payload = Buffer.concat([Buffer.from(seed.repeat(8)), Buffer.alloc(padding, 7)]);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(payload.length + 4, 4);
  header.write('WEBP', 8, 'latin1');
  return Buffer.concat([header, payload]);
}

type PackSpec = { id: string; name: string; description?: string; order?: number; stickers: { id: string; label: string; caption?: string; file?: string }[] };
function newRoot() {
  const root = mkdtempSync(join(tmpdir(), 'geek-sticker-manifest-'));
  roots.push(root);
  return root;
}
function writePack(root: string, spec: PackSpec, images = true) {
  const dir = join(root, spec.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, PACK_FILE), JSON.stringify(spec, null, 2));
  if (images) for (const sticker of spec.stickers) writeFileSync(join(dir, sticker.file ?? `${sticker.id}.webp`), fakeWebp(`${spec.id}/${sticker.id}`));
}
const CATS: PackSpec = { id: 'cats', name: '猫猫', description: '一组猫的表情', order: 20, stickers: [{ id: 'hi', label: '招手', caption: '嗨' }, { id: 'bye', label: '再见' }] };
const DOGS: PackSpec = { id: 'dogs', name: '狗狗', order: 10, stickers: [{ id: 'run', label: '跑', file: 'running-dog.webp' }] };
function twoPacks() {
  const root = newRoot();
  writePack(root, CATS);
  writePack(root, DOGS);
  return root;
}
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const problemsOf = (root: string) => { try { buildManifest(root); return ''; } catch (error) { return (error as Error).message; } };

// 第二、第三个内置包（#286，art 交付的 256×256 透明底 WebP）：表情 id 是原文件名去掉序号、下划线换成连字符，
// 名字是 art 的 name 字段。表在这里写死一份，改了 id 或名字（短码、[包名_名字] 随之变）要同时改这里。
const GEEKDAILY: [string, string][] = [
  ['early-class', '早八上课'], ['ddl', '赶 DDL'], ['coffee', '咖啡续命'], ['commit', '提交'],
  ['ci-pass', 'CI 绿了'], ['ci-fail', 'CI 红了'], ['release', '上线'], ['rollback', '回滚'],
  ['read-logs', '翻日志'], ['read-docs', '查文档'], ['ask-review', '求 review'], ['lgtm', 'LGTM'],
  ['slack-off', '摸鱼'], ['stuck', '卡住了'], ['done', '搞定'], ['off-work', '下班'],
];
const CHATREPLY: [string, string][] = [
  ['yay', '好耶'], ['no-way', '不要啊'], ['hold-on', '等一下'], ['good-work', '辛苦了'],
  ['awesome', '牛啊'], ['really', '真的吗'], ['haha', '哈哈哈'], ['touched', '泪目'],
  ['dash-off', '我先冲了'], ['one-moment', '稍等'], ['ask-help', '请教'], ['please', '拜托了'],
  ['sorry', '抱歉'], ['no-problem', '没问题'], ['let-me-see', '让我康康'], ['farewell', '告辞'],
];

describe('the manifest in the repo', () => {
  it('matches app/server/assets/stickers byte for byte; regenerating changes nothing', () => {
    expect(manifestProblem()).toBe('');
    expect(readFileSync(join(STICKER_ASSETS_DIR, MANIFEST_FILE), 'utf8')).toBe(manifestText(buildManifest()));
    expect(STICKER_ASSETS_DIR).toBe(join(repoRoot, 'app/server/assets/stickers'));
  });

  it('lists every .webp of every pack directory once, with the hash of the file bytes and the content-addressed key', () => {
    const manifest = JSON.parse(readFileSync(join(STICKER_ASSETS_DIR, MANIFEST_FILE), 'utf8')) as ReturnType<typeof buildManifest>;
    const directories = readdirSync(STICKER_ASSETS_DIR).filter(name => statSync(join(STICKER_ASSETS_DIR, name)).isDirectory()).sort();
    expect(manifest.packs.map(pack => pack.id).sort()).toEqual(directories);
    for (const pack of manifest.packs) {
      const files = readdirSync(join(STICKER_ASSETS_DIR, pack.id)).filter(name => name.endsWith('.webp')).sort();
      expect(pack.stickers.map(sticker => sticker.file).sort(), pack.id).toEqual(files);
      for (const sticker of pack.stickers) {
        const file = join(STICKER_ASSETS_DIR, pack.id, sticker.file);
        expect(sticker.sha256, sticker.id).toBe(sha(file));
        expect(sticker.size, sticker.id).toBe(statSync(file).size);
        expect(sticker.key, sticker.id).toBe(`forum/stickers/${sticker.sha256}.webp`);
        expect(`${pack.id}-${sticker.id}`, sticker.id).toMatch(FORUM_LIMITS.stickerShortcodePattern);
      }
    }
  });

  it('is read by the server loader into the very same structure', () => {
    expect(loadStickerManifest(STICKER_ASSETS_DIR)).toEqual(buildManifest());
  });

  it('keeps the first pack at its 24 stickers, each image under 60 KB (the panel draws them at 64px)', () => {
    const [first] = buildManifest().packs;
    expect(first.id).toBe('yugc');
    expect(first.stickers).toHaveLength(24);
    for (const pack of buildManifest().packs) for (const sticker of pack.stickers) expect(sticker.size, `${pack.id}-${sticker.id}`).toBeLessThanOrEqual(LARGE_STICKER_BYTES);
  });

  it('ships three built-in packs in this order: 极客娘 24, 极客日常 16, 聊天回应 16', () => {
    expect(buildManifest().packs.map(pack => [pack.id, pack.name, pack.stickers.length])).toEqual([['yugc', '极客娘', 24], ['geekdaily', '极客日常', 16], ['chatreply', '聊天回应', 16]]);
  });

  it.each<[string, [string, string][]]>([['geekdaily', GEEKDAILY], ['chatreply', CHATREPLY]])(
    '%s: 16 stickers with the delivered ids and names, one <id>.webp each, and the hash in the manifest is the hash of the real file',
    (packId, expected) => {
      const pack = buildManifest().packs.find(item => item.id === packId)!;
      expect(pack.stickers).toHaveLength(16);
      expect(pack.stickers.map(sticker => [sticker.id, sticker.label])).toEqual(expected);
      const dir = join(STICKER_ASSETS_DIR, packId);
      // 目录里只有 pack.json 和这 16 张图，没有多的、没有少的。
      expect(readdirSync(dir).sort()).toEqual([...expected.map(([id]) => `${id}.webp`), PACK_FILE].sort());
      for (const sticker of pack.stickers) {
        const file = join(dir, sticker.file);
        expect(sticker.file, sticker.id).toBe(`${sticker.id}.webp`);
        expect(sticker.sha256, sticker.id).toBe(sha(file));
        expect(sticker.size, sticker.id).toBe(statSync(file).size);
        expect(`${packId}-${sticker.id}`, sticker.id).toMatch(FORUM_LIMITS.stickerShortcodePattern);
      }
    },
  );

  it('keeps the short codes and the [包名_名字] writings unique over all three packs', () => {
    const stickers = buildManifest().packs.flatMap(pack => pack.stickers.map(sticker => ({ shortcode: `${pack.id}-${sticker.id}`, token: `[${pack.name}_${sticker.label}]` })));
    expect(stickers).toHaveLength(56);
    expect(new Set(stickers.map(sticker => sticker.shortcode)).size).toBe(56);
    expect(new Set(stickers.map(sticker => sticker.token)).size).toBe(56);
  });
});

describe('buildManifest: adding a pack is a directory plus pack.json', () => {
  it('orders packs by order then id, defaults the file name to <id>.webp, and keeps only what the server and the CDN need', () => {
    const root = twoPacks();
    const manifest = buildManifest(root);
    expect(manifest.packs.map(pack => pack.id)).toEqual(['dogs', 'cats']);
    expect(manifest.packs[0]).toEqual({
      id: 'dogs', name: '狗狗',
      stickers: [{ id: 'run', label: '跑', file: 'running-dog.webp', sha256: sha(join(root, 'dogs/running-dog.webp')), size: statSync(join(root, 'dogs/running-dog.webp')).size, key: `forum/stickers/${sha(join(root, 'dogs/running-dog.webp'))}.webp` }],
    });
    expect(manifest.packs[1].stickers.map(sticker => sticker.file)).toEqual(['hi.webp', 'bye.webp']);
    // description 与 caption 只留在 pack.json，不进清单。
    expect(JSON.stringify(manifest)).not.toMatch(/description|caption|一组猫的表情|嗨/);
  });

  it('breaks ties between equal orders by pack id, and gives packs without order the default after the explicit small ones', () => {
    const root = newRoot();
    writePack(root, { id: 'zeta', name: 'Z', order: 5, stickers: [{ id: 'a', label: 'A' }] });
    writePack(root, { id: 'alpha', name: 'A', order: 5, stickers: [{ id: 'a', label: 'A' }] });
    writePack(root, { id: 'plain', name: 'P', stickers: [{ id: 'a', label: 'A' }] });
    writePack(root, { id: 'first', name: 'F', order: 0, stickers: [{ id: 'a', label: 'A' }] });
    expect(buildManifest(root).packs.map(pack => pack.id)).toEqual(['first', 'alpha', 'zeta', 'plain']);
  });

  it('is deterministic: the same directory gives the same bytes, and the same image under two names shares one object key', () => {
    const root = twoPacks();
    expect(manifestText(buildManifest(root))).toBe(manifestText(buildManifest(root)));
    writeFileSync(join(root, 'cats/bye.webp'), readFileSync(join(root, 'cats/hi.webp')));
    const cats = buildManifest(root).packs.find(pack => pack.id === 'cats')!;
    expect(cats.stickers[0].key).toBe(cats.stickers[1].key);
    expect(new Set(main(['urls', '--dir', root], { stdout: { write: () => true } as never, log: () => {} }).manifest.packs.flatMap(pack => pack.stickers.map(sticker => stickerCdnUrl(sticker)))).size).toBe(2);
  });

  it('ignores dot files and the manifest itself in the pack directory listing', () => {
    const root = twoPacks();
    writeFileSync(join(root, '.DS_Store'), 'x');
    writeFileSync(join(root, 'cats', '.DS_Store'), 'x');
    writeFileSync(join(root, MANIFEST_FILE), manifestText(buildManifest(root)));
    expect(buildManifest(root).packs).toHaveLength(2);
  });
});

describe('buildManifest: everything wrong is reported together, and no half manifest is written', () => {
  const spec = (patch: Partial<PackSpec> & Record<string, unknown>): PackSpec => ({ ...CATS, ...patch } as PackSpec);
  /** 目录总叫 cats，里面有 hi.webp 与 bye.webp；pack.json 按 patch 改坏一处。 */
  const wrongPack = (name: string, patch: Record<string, unknown>, expected: RegExp) => it(name, () => {
    const root = newRoot();
    mkdirSync(join(root, 'cats'));
    writeFileSync(join(root, 'cats', PACK_FILE), JSON.stringify(spec(patch), null, 2));
    for (const sticker of CATS.stickers) writeFileSync(join(root, 'cats', `${sticker.id}.webp`), fakeWebp(sticker.id));
    expect(problemsOf(root)).toMatch(expected);
  });

  wrongPack('pack id that differs from the directory name', { id: 'kittens' }, /id "kittens" 要和目录名 cats 一致/);
  wrongPack('pack id with capitals', { id: 'Cats' }, /id/);
  wrongPack('missing pack name', { name: '' }, /name 要是 1–40 字/);
  wrongPack('pack name with square brackets', { name: '猫[猫]' }, /name 要是/);
  wrongPack('pack name with surrounding space', { name: ' 猫猫' }, /name 要是/);
  wrongPack('pack name over 40 characters', { name: '猫'.repeat(41) }, /name 要是/);
  wrongPack('an unknown pack field', { color: 'red' }, /不认识的字段 color/);
  wrongPack('order out of range', { order: 1001 }, /order 要是 0–1000 的整数/);
  wrongPack('order that is not an integer', { order: 1.5 }, /order 要是/);
  wrongPack('empty stickers', { stickers: [] }, /stickers 要是至少一个表情的数组/);
  wrongPack('sticker id with capitals', { stickers: [{ id: 'Hi', label: '招手' }] }, /id 要是 1–19 位小写字母/);
  wrongPack('a duplicated sticker id', { stickers: [{ id: 'hi', label: '招手' }, { id: 'hi', label: '再见' }] }, /hi：id 在这个包里重复/);
  wrongPack('a duplicated label (the [包名_名字] form would be ambiguous)', { stickers: [{ id: 'hi', label: '招手' }, { id: 'bye', label: '招手' }] }, /label 招手 在这个包里重名/);
  wrongPack('a label over 20 characters', { stickers: [{ id: 'hi', label: '招'.repeat(21) }] }, /label 要是 1–20 字/);
  wrongPack('a caption over 12 characters', { stickers: [{ id: 'hi', label: '招手', caption: '嗨'.repeat(13) }] }, /caption 要是 1–12 字/);
  wrongPack('an unknown sticker field', { stickers: [{ id: 'hi', label: '招手', size: 3 }] }, /不认识的字段 size/);
  wrongPack('a file name with a path', { stickers: [{ id: 'hi', label: '招手', file: '../hi.webp' }] }, /file 要是包目录里的 \.webp 文件名/);
  wrongPack('a file that is not .webp', { stickers: [{ id: 'hi', label: '招手', file: 'hi.png' }] }, /file 要是包目录里的 \.webp 文件名/);
  wrongPack('a sticker without its image', { stickers: [{ id: 'hi', label: '招手' }, { id: 'ghost', label: '幽灵' }] }, /ghost：包目录里没有 ghost\.webp/);
  wrongPack('two stickers pointing at one file', { stickers: [{ id: 'hi', label: '招手', file: 'bye.webp' }, { id: 'bye', label: '再见' }] }, /bye\.webp 已经是别的表情的图片/);

  it('an image in the directory that pack.json does not list', () => {
    const root = twoPacks();
    writeFileSync(join(root, 'cats', 'extra.webp'), fakeWebp('extra'));
    expect(problemsOf(root)).toMatch(/cats\/extra\.webp：没有写进 pack\.json 的 stickers/);
  });

  it('a file that is not a WebP, a symlink, a subfolder, and a file that is too large', () => {
    const root = twoPacks();
    writeFileSync(join(root, 'cats', 'hi.webp'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    symlinkSync('/etc/hosts', join(root, 'cats', 'link.webp'));
    mkdirSync(join(root, 'cats', 'nested'));
    writeFileSync(join(root, 'dogs', 'running-dog.webp'), fakeWebp('big', MAX_STICKER_BYTES));
    const message = problemsOf(root);
    expect(message).toMatch(/hi：hi\.webp 不是 WebP 图片/);
    expect(message).toMatch(/cats\/link\.webp：包目录里只放 pack\.json 和 \.webp 普通文件/);
    expect(message).toMatch(/cats\/nested：包目录里只放/);
    expect(message).toMatch(/run：running-dog\.webp 有 \d+ 字节，超过 1048576，先压缩/);
  });

  it('two packs with the same display name, and a shortcode that collides across packs', () => {
    const root = twoPacks();
    writePack(root, { id: 'dogs', name: '猫猫', stickers: [{ id: 'run', label: '跑' }] });
    expect(problemsOf(root)).toMatch(/name 猫猫 和 cats 重名/);
    const other = newRoot();
    writePack(other, { id: 'a', name: 'A', stickers: [{ id: 'b-c', label: '一' }] });
    writePack(other, { id: 'a-b', name: 'AB', stickers: [{ id: 'c', label: '二' }] });
    expect(problemsOf(other)).toMatch(/短码 a-b-c 和 a\/b-c 重复/);
  });

  it('a pack directory without pack.json, a broken pack.json, and a stray file in the folder', () => {
    const root = twoPacks();
    mkdirSync(join(root, 'empty'));
    mkdirSync(join(root, 'broken'));
    writeFileSync(join(root, 'broken', PACK_FILE), '{');
    writeFileSync(join(root, 'stray.webp'), fakeWebp('stray'));
    const message = problemsOf(root);
    expect(message).toMatch(/empty\/pack\.json：缺这个文件/);
    expect(message).toMatch(/broken\/pack\.json：读不出来/);
    expect(message).toMatch(/stray\.webp：表情目录里只放包目录和 manifest\.json/);
  });

  it('no packs at all, and a missing directory', () => {
    expect(problemsOf(newRoot())).toMatch(/一个表情包都没有/);
    expect(problemsOf(join(newRoot(), 'nope'))).toMatch(/没有表情目录/);
  });

  it('reports every problem in one error instead of stopping at the first', () => {
    const root = twoPacks();
    writePack(root, spec({ id: 'cats', name: '', stickers: [{ id: 'Hi', label: '招手' }] }), false);
    writeFileSync(join(root, 'dogs', 'extra.webp'), fakeWebp('extra'));
    const message = problemsOf(root);
    expect(message).toMatch(/cats\/pack\.json：name/);
    expect(message).toMatch(/dogs\/extra\.webp：没有写进/);
  });
});

describe('commands', () => {
  const capture = () => {
    const out: string[] = [];
    const logs: string[] = [];
    return { out, logs, io: { stdout: { write: (text: string) => { out.push(text); return true; } } as never, log: (text: string) => { logs.push(text); } } };
  };

  it('write creates manifest.json, check passes on it and fails after the directory changes, until write runs again', () => {
    const root = twoPacks();
    const first = capture();
    expect(manifestProblem(root)).toMatch(/manifest\.json 不存在/);
    expect(() => main(['check', '--dir', root], first.io)).toThrow(/manifest\.json 不存在/);
    main(['write', '--dir', root], first.io);
    expect(first.logs.join('\n')).toMatch(/2 个包，3 张表情/);
    const written = readFileSync(join(root, MANIFEST_FILE), 'utf8');
    expect(written).toBe(manifestText(buildManifest(root)));
    expect(written.endsWith('}\n')).toBe(true);
    expect(manifestProblem(root)).toBe('');
    main(['check', '--dir', root], first.io);

    writePack(root, { id: 'birds', name: '小鸟', order: 30, stickers: [{ id: 'fly', label: '飞' }] });
    expect(() => main(['check', '--dir', root], first.io)).toThrow(/和目录对不上.*node scripts\/sticker-manifest\.mjs write/);
    main(['write', '--dir', root], first.io);
    expect(manifestProblem(root)).toBe('');
    writeFileSync(join(root, 'birds', 'fly.webp'), fakeWebp('changed'));
    expect(manifestProblem(root)).toMatch(/对不上/);
    main(['write', '--dir', root], first.io);
    const again = readFileSync(join(root, MANIFEST_FILE), 'utf8');
    main(['write', '--dir', root], first.io);
    expect(readFileSync(join(root, MANIFEST_FILE), 'utf8')).toBe(again);
  });

  it('write refuses to produce a manifest from a bad directory and leaves the old one alone', () => {
    const root = twoPacks();
    main(['write', '--dir', root], capture().io);
    const before = readFileSync(join(root, MANIFEST_FILE), 'utf8');
    writeFileSync(join(root, 'cats', 'extra.webp'), fakeWebp('extra'));
    expect(() => main(['write', '--dir', root], capture().io)).toThrow(/没有写进 pack\.json/);
    expect(readFileSync(join(root, MANIFEST_FILE), 'utf8')).toBe(before);
  });

  it('urls prints one absolute CDN address per distinct image, all under the fixed prefix', () => {
    const root = twoPacks();
    const { out, io } = capture();
    main(['urls', '--dir', root], io);
    const lines = out.join('').trim().split('\n');
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line, line).toMatch(new RegExp(`^${STATIC_CDN_BASE.replaceAll('.', '\\.')}forum/stickers/[0-9a-f]{64}\\.webp$`));
    expect(lines).toEqual(buildManifest(root).packs.flatMap(pack => pack.stickers.map(sticker => `${STATIC_CDN_BASE}${sticker.key}`)));
  });

  it('report lists each sticker with its bytes and flags the ones over 60 KB, without writing anything', () => {
    const root = newRoot();
    writePack(root, { id: 'mix', name: '混合', stickers: [{ id: 'small', label: '小' }, { id: 'large', label: '大' }] });
    writeFileSync(join(root, 'mix', 'large.webp'), fakeWebp('large', LARGE_STICKER_BYTES + 100));
    const { out, logs, io } = capture();
    const result = main(['report', '--dir', root], io);
    const text = out.join('');
    expect(text).toMatch(/混合（mix）2 张/);
    expect(text).toMatch(/mix-small\s+small\.webp\s+\d+ 字节\s+[\d.]+ KB\n/);
    expect(text).toMatch(/mix-large\s+large\.webp\s+\d+ 字节\s+[\d.]+ KB  超过 60 KB\n/);
    expect(result.large).toEqual(['mix-large']);
    expect(logs.join('\n')).toMatch(/共 1 个包、2 张.*超过 60 KB 的 1 张：mix-large/);
    expect(readdirSync(root).sort()).toEqual(['mix']);
  });

  it('report on the real directory runs and finds nothing over 60 KB', () => {
    const { out, logs, io } = capture();
    const result = main(['report'], io);
    expect(out.join('')).toMatch(/yugc-wave\s+wave\.webp/);
    expect(result.large).toEqual([]);
    expect(logs.join('\n')).toMatch(/超过 60 KB 的 0 张/);
  });

  it('parses its arguments strictly', () => {
    expect(parseArgs(['check']).dir).toBe(STICKER_ASSETS_DIR);
    expect(parseArgs(['write', '--dir', '/tmp/x']).dir).toBe('/tmp/x');
    expect(() => parseArgs([])).toThrow(/用法/);
    expect(() => parseArgs(['delete'])).toThrow(/用法/);
    expect(() => parseArgs(['write', '--force', 'x'])).toThrow(/不认识参数 --force/);
    expect(() => parseArgs(['write', '--dir'])).toThrow(/--dir 缺值/);
    expect(() => parseArgs(['write', '--dir', '--other'])).toThrow(/--dir 缺值/);
  });

  it('keeps the object key rule in one shape: forum/stickers/<64 hex>.webp under the upload prefix', () => {
    const hash = 'ab'.repeat(32);
    expect(stickerObjectKey(hash)).toBe(`forum/stickers/${hash}.webp`);
    expect(STICKER_KEY_PREFIX).toBe('forum/stickers/');
    expect(stickerCdnUrl({ key: stickerObjectKey(hash) }, STATIC_CDN_BASE)).toBe(`${STATIC_CDN_BASE}forum/stickers/${hash}.webp`);
  });
});
