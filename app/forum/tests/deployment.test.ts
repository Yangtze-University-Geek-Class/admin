import { expect, it } from 'vitest'
import { createDeploymentMetadata, deploymentDisplay } from '../shared/deployment'

const contract = { environments: { preview: { origin: 'https://prev.yangtzeu.work', label: '预发布环境' }, production: { origin: 'https://yangtzeu.work', label: '正式环境' } } }
const sha = 'a'.repeat(40)
it('local development does not pretend to be a release', () => {
  expect(createDeploymentMetadata(contract)).toMatchObject({ environment: 'local', displayVersion: '未发布' })
})
it('binds the selected environment to its canonical domain', () => {
  const preview = createDeploymentMetadata(contract, 'preview', '1.2.0-rc.1@aaaaaaaaaaaa', sha)
  expect(preview.origin).toBe('https://prev.yangtzeu.work')
  expect(preview.displayVersion).toBe('1.2.0-rc.1@aaaaaaaaaaaa')
  expect(deploymentDisplay(preview, 'prev.yangtzeu.work').label).toBe('预发布环境')
  expect(deploymentDisplay(preview, 'yangtzeu.work').configurationMismatch).toBe(true)
  expect(deploymentDisplay(preview, '127.0.0.1').label).toBe('本地开发')
  expect(createDeploymentMetadata(contract, 'preview', '10.0.3-rc.12@aaaaaaaaaaaa', sha).displayVersion).toBe('10.0.3-rc.12@aaaaaaaaaaaa')
})
it.each([
  ['production', '1.2.0@aaaaaaaaaaaa', sha],
  ['preview', '1.2.0@bbbbbbbbbbbb', sha],
  ['preview', '1.2.0', 'short'],
  ['production', '', sha],
  ['prev', '1.2.0', sha],
  // Tag model: preview must carry the rc number and the commit, production neither.
  ['preview', '1.2.0@aaaaaaaaaaaa', sha],
  ['preview', '1.2.0', sha],
  ['preview', '1.2.0-rc.1', sha],
  ['preview', '1.2.0-rc.1@bbbbbbbbbbbb', sha],
  ['preview', '1.2.0-rc.0@aaaaaaaaaaaa', sha],
  ['preview', '1.2.0-rc.01@aaaaaaaaaaaa', sha],
  ['preview', '1.2.0-rc1@aaaaaaaaaaaa', sha],
  ['preview', '1.2.0-beta.1@aaaaaaaaaaaa', sha],
  ['preview', 'v1.2.0-rc.1@aaaaaaaaaaaa', sha],
  ['production', '1.2.0-rc.1', sha],
  ['production', '1.2.0-rc.1@aaaaaaaaaaaa', sha],
  ['production', 'v1.2.0', sha],
  ['production', '01.2.0', sha],
])('rejects invalid release metadata %s %s', (environment, version, commit) => {
  expect(() => createDeploymentMetadata(contract, environment, version, commit)).toThrow()
})
it('production uses a bare version without a commit suffix', () => {
  const value = createDeploymentMetadata(contract, 'production', '1.2.0', sha)
  expect(value.origin).toBe('https://yangtzeu.work')
  expect(deploymentDisplay(value, 'yangtzeu.work').configurationMismatch).toBe(false)
})
