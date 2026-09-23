import { buildApp } from '../../app/server/src/app';
import { createConfig } from '../../app/server/src/config';
import type { ServiceOverrides } from '../../app/server/src/services';

/** Core-only fixture. A missing/deprecated FORUM_DB_PATH must never be opened. */
export async function testApp(overrides: ServiceOverrides = {}, production = false) {
  const config = createConfig({
    NODE_ENV: production ? 'production' : 'test',
    PUBLIC_ORIGIN: 'https://example.test', DB_PATH: ':memory:',
    FORUM_DB_PATH: '/nonexistent/never-open-legacy-forum.db',
    SESSION_SECRET: 'isolated-core-test-secret-at-least-32',
    ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    OAUTH_CLIENT_ID: 'test-client', OAUTH_CLIENT_SECRET: 'test-only-placeholder', POW_DIFFICULTY: '0',
  });
  const deny = () => { throw new Error('Unexpected external network request in isolated core test'); };
  const app = await buildApp({ config, staticRoot: false, overrides: { httpRequest: deny as unknown as ServiceOverrides['httpRequest'], octokitFactory: deny, ...overrides } });
  await app.ready();
  return { app, close: () => app.close() };
}
