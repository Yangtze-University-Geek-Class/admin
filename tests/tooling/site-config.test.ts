import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { CONFIG_PATH, checkSiteConfig, checkSiteConfigText } from '../../scripts/check-site-config.mjs';

// 只读仓库里的公开前端配置；变体全部在内存里构造，不改写任何文件。
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const committed = JSON.parse(readFileSync(join(repoRoot, CONFIG_PATH), 'utf8'));
const variant = (mutate: (config: typeof committed) => void) => {
  const config = structuredClone(committed);
  mutate(config);
  return JSON.stringify(config);
};

describe('front-end site config (one origin per environment)', () => {
  it('accepts the committed config: no hosts, forum under /forum, production data is live', () => {
    expect(checkSiteConfig()).toEqual({ portal: { basePath: '' }, forum: { basePath: '/forum' }, admin: { basePath: '' } });
    for (const site of ['portal', 'forum', 'admin']) expect(committed.sites[site]).not.toHaveProperty('host');
    const cli = spawnSync(process.execPath, [join(repoRoot, 'scripts/check-site-config.mjs')], { encoding: 'utf8' });
    expect(cli.status).toBe(0);
    expect(cli.stdout).toContain('forum.basePath=/forum');
  });

  it.each(['portal', 'forum', 'admin'])('rejects a host field on sites.%s', site => {
    expect(() => checkSiteConfigText(variant(config => { config.sites[site].host = 'yangtzeu.work'; }))).toThrow(/不得带 host/);
  });

  it('rejects a missing site, an empty or overlapping forum basePath and malformed paths', () => {
    expect(() => checkSiteConfigText(variant(config => { delete config.sites.admin; }))).toThrow(/sites\.admin/);
    expect(() => checkSiteConfigText(variant(config => { config.sites.forum.basePath = ''; }))).toThrow(/forum\.basePath 必须非空/);
    expect(() => checkSiteConfigText(variant(config => { config.sites.admin.basePath = '/forum'; }))).toThrow(/重叠/);
    expect(() => checkSiteConfigText(variant(config => { config.sites.portal.basePath = '/forum/portal'; }))).toThrow(/重叠/);
    expect(() => checkSiteConfigText(variant(config => { config.sites.forum.basePath = '/Forum/'; }))).toThrow(/basePath/);
    expect(() => checkSiteConfigText('{ not json')).toThrow(/合法 JSON/);
  });

  it('keeps the production data source fixed to live', () => {
    expect(() => checkSiteConfigText(variant(config => { config.environment.production.dataSource = 'mock'; }))).toThrow(/live/);
    expect(() => checkSiteConfigText(variant(config => { config.environment.production.allowDataSourceOverride = true; }))).toThrow(/live/);
  });
});
