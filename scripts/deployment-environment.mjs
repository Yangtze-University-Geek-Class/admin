#!/usr/bin/env node
/** Public release-target contract; read-only, no SSH/DNS/deployment effects. */
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const contract = JSON.parse(readFileSync(new URL('../deploy/environments.json', import.meta.url), 'utf8'));
const EXPECTED = {
  preview: { origin: 'https://prev.yangtzeu.work', tagPrefix: 'prev-', allowCommitSuffix: true },
  production: { origin: 'https://yangtzeu.work', tagPrefix: 'release-', allowCommitSuffix: false },
};

export function validateEnvironmentContract(value = contract) {
  if (value?.schemaVersion !== 1 || Object.keys(value.environments ?? {}).sort().join(',') !== 'preview,production') throw new Error('Deployment environments must be explicitly preview and production');
  for (const [name, expected] of Object.entries(EXPECTED)) {
    const actual = value.environments[name];
    if (!actual || actual.origin !== expected.origin || actual.tagPrefix !== expected.tagPrefix || actual.allowCommitSuffix !== expected.allowCommitSuffix || actual.githubEnvironment !== name || typeof actual.label !== 'string') throw new Error(`Invalid release target contract for ${name}`);
  }
  return value;
}

export function deploymentTarget(environment, requestedOrigin) {
  validateEnvironmentContract();
  if (!Object.hasOwn(EXPECTED, environment)) throw new Error('Unknown deployment environment; no default to production');
  const value = contract.environments[environment];
  if (requestedOrigin !== undefined) {
    let url;
    try { url = new URL(requestedOrigin); } catch { throw new Error('Invalid deployment origin'); }
    if (url.origin !== value.origin || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Tag environment and requested domain do not match');
  }
  return Object.freeze({ environment, ...value });
}

// 入口判定必须走 realpath：脚本经符号链接路径启动时，直接比较 resolve(process.argv[1]) 会不相等，
// 导致 --check 静默不执行却返回 0，被误当作合同校验通过。
function isDirectRun() {
  if (!process.argv[1]) return false;
  try { return pathToFileURL(realpathSync(resolve(process.argv[1]))).href === import.meta.url; } catch { return false; }
}
if (isDirectRun()) {
  try {
    if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--check')) throw new Error('Usage: node scripts/deployment-environment.mjs --check');
    validateEnvironmentContract();
    console.log('Environment contract passed: prev-* -> https://prev.yangtzeu.work; release-* -> https://yangtzeu.work. No deployment was performed.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
