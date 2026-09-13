import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { compareVersions, inspectRelease, parseReleaseTag, parseVersion, previewVersion } from '../../scripts/release-policy.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', '-c', 'tag.gpgSign=false', '-c', 'user.name=Release test fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'geek-release-fixture-')); roots.push(cwd);
  git(cwd, 'init', '--initial-branch=main');
  writeFileSync(join(cwd, 'fixture.txt'), 'synthetic fixture'); git(cwd, 'add', 'fixture.txt'); git(cwd, 'commit', '-m', 'fixture baseline');
  const first = git(cwd, 'rev-parse', 'HEAD'); git(cwd, 'tag', 'prev-1.2.0');
  git(cwd, 'commit', '--allow-empty', '-m', 'fixture main update');
  const current = git(cwd, 'rev-parse', 'HEAD');
  return { cwd, first, current, mainRef: 'refs/heads/main' };
}

describe('release syntax and explicit no-approval semantics', () => {
  it('maps the two literal prefixes to different environments', () => {
    expect(parseReleaseTag('release-1.2.0')).toMatchObject({ environment: 'production', version: '1.2.0' });
    expect(parseReleaseTag('prev-1.2.0')).toMatchObject({ environment: 'preview', version: '1.2.0' });
  });
  it.each(['v1.2.0', 'preview-1.2.0', 'release-01.2.0', 'prev-1.2', 'release-1.2.0@abcdef', 'prev-1.2.0-rc.1', 'release-1.2.0+build', 'prev-1.2.0\n', 'refs/heads/release-1.2.0'])('rejects malformed or misleading tag %s', (tag) => {
    expect(() => parseReleaseTag(tag)).toThrow();
  });
  it('retains the base version and adds the selected commit prefix only in preview', () => {
    expect(previewVersion('prev-1.2.0', 'a'.repeat(40))).toBe('1.2.0@aaaaaaaaaaaa');
    expect(() => previewVersion('release-1.2.0', 'a'.repeat(40))).toThrow();
    expect(() => previewVersion('prev-1.2.0', 'a'.repeat(12))).toThrow();
  });
  it('compares versions numerically, without floating point precision loss', () => {
    expect(compareVersions('1.10.0', '1.2.9')).toBe(1);
    expect(compareVersions('9007199254740993.0.0', '9007199254740992.0.0')).toBe(1);
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
    expect(() => parseVersion('1.2.0 ')).toThrow();
  });
});

describe('read-only checks against isolated Git fixtures, never the real project', () => {
  it('keeps preview anchored to main without updating version, files or tags', () => {
    const f = fixture(); const before = git(f.cwd, 'show-ref');
    const plan = inspectRelease({ ...f, mode: 'preview', baseTag: 'prev-1.2.0', commit: f.current });
    expect(plan).toMatchObject({ baseVersion: '1.2.0', commit: f.current, bumpsVersion: false, deploymentAuthorized: false, requiresTrustedBaselineAcceptance: true });
    expect(plan.displayVersion).toBe(`1.2.0@${f.current.slice(0, 12)}`);
    expect(plan.publicOrigin).toBe('https://prev.yangtzeu.work');
    expect(() => inspectRelease({ ...f, mode: 'preview', baseTag: 'prev-1.2.0', commit: f.current, targetOrigin: 'https://yangtzeu.work' })).toThrow(/domain/);
    expect(git(f.cwd, 'show-ref')).toBe(before);
    expect(git(f.cwd, 'status', '--porcelain')).toBe('');
  });
  it('resolves an annotated production tag to the exact tested commit, without an @ suffix', () => {
    const f = fixture(); git(f.cwd, 'tag', '-a', 'release-1.2.0', '-m', 'synthetic only');
    expect(inspectRelease({ cwd: f.cwd, mainRef: f.mainRef, mode: 'tag', tag: 'release-1.2.0' }).publicOrigin).toBe('https://yangtzeu.work');
    expect(() => inspectRelease({ cwd: f.cwd, mainRef: f.mainRef, mode: 'tag', tag: 'release-1.2.0', targetOrigin: 'https://prev.yangtzeu.work' })).toThrow(/domain/);
    expect(inspectRelease({ cwd: f.cwd, mainRef: f.mainRef, mode: 'tag', tag: 'release-1.2.0' })).toMatchObject({ environment: 'production', displayVersion: '1.2.0', commit: f.current, deploymentAuthorized: false, requiresHumanAcceptanceForExactArtifact: true });
  });
  it('rejects next as the publication mainline', () => {
    const f = fixture();
    expect(() => inspectRelease({ ...f, mode: 'preview', mainRef: 'refs/heads/next', baseTag: 'prev-1.2.0', commit: f.current })).toThrow(/main/);
  });
  it('rejects a feature commit not merged into main', () => {
    const f = fixture(); git(f.cwd, 'checkout', '-b', 'feature'); git(f.cwd, 'commit', '--allow-empty', '-m', 'synthetic feature');
    const commit = git(f.cwd, 'rev-parse', 'HEAD');
    expect(() => inspectRelease({ ...f, mode: 'preview', baseTag: 'prev-1.2.0', commit })).toThrow(/main/);
  });
  it('rejects an absent baseline rather than inventing an initial release', () => {
    const f = fixture();
    expect(() => inspectRelease({ ...f, mode: 'preview', baseTag: 'prev-1.3.0', commit: f.current })).toThrow();
  });
  it('rejects a baseline that is ahead of the selected commit', () => {
    const f = fixture(); git(f.cwd, 'tag', 'prev-1.3.0');
    expect(() => inspectRelease({ ...f, mode: 'preview', baseTag: 'prev-1.3.0', commit: f.first })).toThrow(/历史/);
  });
  it('rejects reuse of an older reachable preview baseline', () => {
    const f = fixture(); git(f.cwd, 'tag', 'prev-1.3.0');
    expect(() => inspectRelease({ ...f, mode: 'preview', baseTag: 'prev-1.2.0', commit: f.current })).toThrow(/新预发布基准/);
  });
  it('rejects version downgrade as a new release, without moving any tag', () => {
    const f = fixture(); git(f.cwd, 'tag', 'release-1.2.0'); git(f.cwd, 'tag', 'release-1.3.0');
    expect(() => inspectRelease({ cwd: f.cwd, mainRef: f.mainRef, mode: 'tag', tag: 'release-1.2.0' })).toThrow(/旧版本/);
  });
  it('does not accept an approval bypass switch on the CLI', () => {
    const result = spawnSync(process.execPath, ['scripts/release-policy.mjs', 'preview', '--approved', 'true'], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('批准开关');
  });
});
