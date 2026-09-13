import { expect, it } from 'vitest';
import { deploymentTarget, validateEnvironmentContract } from '../../scripts/deployment-environment.mjs';

it('binds production releases to the apex domain and preview to the prev subdomain', () => {
  expect(deploymentTarget('preview')).toMatchObject({ origin: 'https://prev.yangtzeu.work', tagPrefix: 'prev-', allowCommitSuffix: true });
  expect(deploymentTarget('production')).toMatchObject({ origin: 'https://yangtzeu.work', tagPrefix: 'release-', allowCommitSuffix: false });
});
it.each([
  ['preview', 'https://yangtzeu.work'],
  ['production', 'https://prev.yangtzeu.work'],
  ['preview', 'http://prev.yangtzeu.work'],
  ['preview', 'https://prev.yangtzeu.work.attacker.example'],
  ['preview', 'https://prev.yangtzeu.work@attacker.example'],
  ['production', 'https://user:password@yangtzeu.work'],
  ['production', 'https://yangtzeu.work:8443'],
  ['production', 'https://yangtzeu.work/path'],
  ['preview', 'https://prev.yangtzeu.work?environment=production'],
])('rejects crossed or malformed target %s %s', (environment, origin) => {
  expect(() => deploymentTarget(environment, origin)).toThrow();
});
it('accepts a matching canonical origin and rejects unknown environment labels', () => {
  expect(deploymentTarget('preview', 'https://prev.yangtzeu.work/').origin).toBe('https://prev.yangtzeu.work');
  expect(() => deploymentTarget('prev')).toThrow();
  expect(() => deploymentTarget('development')).toThrow();
  expect(() => deploymentTarget('__proto__')).toThrow();
});
it('does not silently accept swapped environment configuration', () => {
  const valid = validateEnvironmentContract();
  const changed = structuredClone(valid);
  changed.environments.preview.origin = 'https://yangtzeu.work';
  expect(() => validateEnvironmentContract(changed)).toThrow();
});
