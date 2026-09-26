import { fileURLToPath } from 'node:url';
import { buildApp } from '../../app/server/src/app';
import { createConfig } from '../../app/server/src/config';
import type { ServiceOverrides } from '../../app/server/src/services';

/** 论坛内容夹具（分类、标签、两篇旧帖），代替 app/forum/content 的真实文件。 */
export const FORUM_FIXTURE_DIR = fileURLToPath(new URL('./fixtures/forum-content', import.meta.url));

/** createConfig 之后把论坛内容目录换成夹具：测试不读真实的论坛内容。 */
export function testConfig(env: Record<string, string | undefined>) {
  return { ...createConfig(env), forumContentDir: FORUM_FIXTURE_DIR };
}

/** Core-only fixture. A missing/deprecated FORUM_DB_PATH must never be opened. `env` 覆盖个别环境变量（例如 TRUST_PROXY）。 */
export async function testApp(overrides: ServiceOverrides = {}, production = false, env: Record<string, string> = {}) {
  const config = testConfig({
    NODE_ENV: production ? 'production' : 'test',
    PUBLIC_ORIGIN: 'https://example.test', DB_PATH: ':memory:',
    FORUM_DB_PATH: '/nonexistent/never-open-legacy-forum.db',
    SESSION_SECRET: 'isolated-core-test-secret-at-least-32',
    ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    OAUTH_CLIENT_ID: 'test-client', OAUTH_CLIENT_SECRET: 'test-only-placeholder', POW_DIFFICULTY: '0',
    ...env,
  });
  const deny = () => { throw new Error('Unexpected external network request in isolated core test'); };
  const app = await buildApp({ config, staticRoot: false, overrides: { httpRequest: deny as unknown as ServiceOverrides['httpRequest'], octokitFactory: deny, ...overrides } });
  await app.ready();
  return { app, close: () => app.close() };
}
