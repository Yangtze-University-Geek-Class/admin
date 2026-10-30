import { afterEach, beforeEach, vi } from 'vitest';
import { STATIC_CDN_ORIGIN } from './static-cdn-fixture';

/** 测试文件顶层调用：每个用例前把 STATIC_CDN_ORIGIN 放进 process.env（与部署环境文件同值），用后还原。 */
export function useStaticCdnOrigin() {
  beforeEach(() => { vi.stubEnv('STATIC_CDN_ORIGIN', STATIC_CDN_ORIGIN); });
  afterEach(() => { vi.unstubAllEnvs(); });
}
