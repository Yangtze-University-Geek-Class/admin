import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATIC_CDN_BASE, STATIC_CDN_ORIGIN, STATIC_CDN_PREFIX, forumCdnURL, staticCdnBase } from '../../scripts/static-cdn-base.mjs';

// 静态资源 CDN（#146）的构建开关：STATIC_CDN_BASE 的取值规则、官网与控制台的 Vite 配置、论坛的 Nuxt 配置，
// 以及 web、forum 两个 Dockerfile 的接线。上传脚本在 static-cdn.test.ts，部署工作流在 static-cdn-workflows.test.ts。
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8');

describe('build switch STATIC_CDN_BASE', () => {
  it('is empty (same origin) unless set to exactly the one CDN base', () => {
    expect(STATIC_CDN_BASE).toBe(`${STATIC_CDN_ORIGIN}/${STATIC_CDN_PREFIX}`);
    expect(STATIC_CDN_BASE).toBe('https://cdn.crosery.com/yzgc/static/site/');
    expect(STATIC_CDN_PREFIX.startsWith('yzgc/static/')).toBe(true);
    expect(staticCdnBase({})).toBe('');
    expect(staticCdnBase({ STATIC_CDN_BASE: '' })).toBe('');
    expect(staticCdnBase({ STATIC_CDN_BASE: '  ' })).toBe('');
    expect(staticCdnBase({ STATIC_CDN_BASE })).toBe(STATIC_CDN_BASE);
    for (const wrong of ['https://cdn.crosery.com/', 'https://cdn.crosery.com/yzgc/static/site', 'http://cdn.crosery.com/yzgc/static/site/', 'https://evil.example/yzgc/static/site/', 'https://cdn.crosery.com/yzgc/promo/']) {
      expect(() => staticCdnBase({ STATIC_CDN_BASE: wrong }), wrong).toThrow(/只能为空或/);
    }
  });

  it('puts the forum under <base>forum/, matching its /forum/ mount on the origin', () => {
    expect(forumCdnURL(STATIC_CDN_BASE, '/forum/')).toBe(`${STATIC_CDN_BASE}forum/`);
    expect(forumCdnURL(STATIC_CDN_BASE, '/')).toBe(STATIC_CDN_BASE);
    for (const wrong of ['forum/', '/forum', '/../', '//x/']) expect(() => forumCdnURL(STATIC_CDN_BASE, wrong), wrong).toThrow(/baseURL/);
  });

  describe('Vite configs of the portal and the console', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.resetModules();
    });
    const load = async (value: string) => {
      vi.resetModules();
      vi.stubEnv('STATIC_CDN_BASE', value);
      const web = (await import('../../app/web/vite.config.ts')).default as { base?: string; experimental?: { renderBuiltUrl?: (file: string, ctx: { type: string }) => unknown } };
      const admin = (await import('../../app/console/vite.config.ts')).default as typeof web;
      return { web, admin };
    };

    it('keep today\'s same-origin output when the switch is off', async () => {
      const { web, admin } = await load('');
      expect(web.experimental).toBeUndefined();
      expect(admin.experimental).toBeUndefined();
      expect(admin.base).toBe('/');
    });

    it('send only hashed build assets to the CDN when it is on; public files and the base stay on the origin', async () => {
      const { web, admin } = await load(STATIC_CDN_BASE);
      expect(web.experimental?.renderBuiltUrl?.('assets/portal-Br-Bop_b.js', { type: 'asset' })).toBe(`${STATIC_CDN_BASE}assets/portal-Br-Bop_b.js`);
      expect(web.experimental?.renderBuiltUrl?.('portal/wallpapers/a.webp', { type: 'public' })).toBeUndefined();
      expect(admin.experimental?.renderBuiltUrl?.('console-assets/index-12345678.css', { type: 'asset' })).toBe(`${STATIC_CDN_BASE}console-assets/index-12345678.css`);
      expect(admin.base).toBe('/');
      expect(web.base ?? '/').toBe('/');
    });

    it('refuse to build with any other CDN address', async () => {
      await expect(load('https://evil.example/yzgc/static/site/')).rejects.toThrow(/只能为空或/);
    });
  });

  it('sets the forum cdnURL and turns off the outdated-build check only when the switch is on', () => {
    const nuxt = read('app/forum/nuxt.config.ts');
    expect(nuxt).toContain("import { forumCdnURL, staticCdnBase } from '../../scripts/static-cdn-base.mjs'");
    expect(nuxt).toContain('...(cdnBase ? { cdnURL: forumCdnURL(cdnBase, forumBaseURL) } : {}),');
    expect(nuxt).toContain('...(cdnBase ? { experimental: { checkOutdatedBuildInterval: false as const } } : {}),');
    expect(nuxt).toContain('plugins: cdnBase ? [hashPublicImports()] : [],');
  });
});

describe('images', () => {
  it('declare STATIC_CDN_BASE in the web and forum build stages only, and check the entry points follow it', () => {
    for (const service of ['web', 'forum']) {
      const dockerfile = read(`app/${service}/Dockerfile`);
      const [preamble, builder, runtime] = dockerfile.split(/^(?=FROM )/m);
      expect(preamble, service).not.toMatch(/STATIC_CDN/);
      expect(builder, service).toContain('\nARG STATIC_CDN_BASE=""\n');
      expect(runtime, service).not.toMatch(/STATIC_CDN/);
    }
    expect(read('app/server/Dockerfile')).not.toMatch(/STATIC_CDN/);
    const web = read('app/web/Dockerfile');
    expect(web).toContain('STATIC_CDN_BASE="$STATIC_CDN_BASE" pnpm --filter @yzgc/web build');
    expect(web).toContain('STATIC_CDN_BASE="$STATIC_CDN_BASE" pnpm --filter @yzgc/console build');
    expect(web).toContain('grep -q "src=\\"${STATIC_CDN_BASE:-/}assets/" app/web/dist/sites/portal/index.html');
    expect(web).toContain('grep -q "src=\\"${STATIC_CDN_BASE:-/}console-assets/" app/console/dist/sites/console/index.html');
    const forum = read('app/forum/Dockerfile');
    expect(forum).toContain('COPY scripts/static-cdn-base.mjs /repo/scripts/static-cdn-base.mjs\n');
    expect(forum).toContain('    STATIC_CDN_BASE="$STATIC_CDN_BASE" \\\n    pnpm exec nuxt generate \\\n');
    expect(forum).toContain('grep -q "\\"#entry\\":\\"${entry:-/forum/_nuxt/}" .output/public/index.html');
  });
});
