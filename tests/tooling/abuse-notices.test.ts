import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { honeypotNginxPattern } from '../../app/server/src/lib/shield';

// 蜜罐路径（#333 追加）的 web 侧核对：蜜罐路径的 nginx 正则由服务端的前缀表生成后核对。
// nginx 自己回的 429 体与 SHIELD_NOTICE 一致，由 tests/tooling/web-nginx.test.ts 起真实 nginx 打出 429 后比对。
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8');
const dockerfile = () => read('app/web/Dockerfile');

describe('web nginx 的蜜罐路径与 security.txt（#333 追加）', () => {
  it('蜜罐路径转给 server，正则由服务端的前缀表生成，两边逐字一致', () => {
    const text = dockerfile();
    expect(text).toContain(`location ~* ${honeypotNginxPattern()} {`);
    const block = text.slice(text.indexOf(`location ~* ${honeypotNginxPattern()} {`));
    expect(block.slice(0, 400)).toMatch(/proxy_pass http:\/\/server:3000;\n\s*include \/etc\/nginx\/conf\.d\/90-proxy-headers\.conf;/);
  });

  it('/.well-known/security.txt 转给 server，不落到 SPA 入口', () => {
    expect(dockerfile()).toMatch(/location = \/\.well-known\/security\.txt \{\n\s*proxy_pass http:\/\/server:3000;\n\s*include \/etc\/nginx\/conf\.d\/90-proxy-headers\.conf;/);
  });
});

describe('发版构建不对外发布 source map（#333 追加）', () => {
  it('门户与控制台的 vite 构建都关闭 sourcemap', () => {
    expect(read('app/web/vite.config.ts')).toMatch(/sourcemap: false,/);
    expect(read('app/console/vite.config.ts')).toMatch(/sourcemap: false,/);
  });
});
