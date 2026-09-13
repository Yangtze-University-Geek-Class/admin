import { expect, it } from 'vitest'
import { createDeploymentMetadata, deploymentDisplay } from '../shared/deployment'

const contract = { environments: { preview: { origin: 'https://prev.yangtzeu.work', label: '预发布环境' }, production: { origin: 'https://yangtzeu.work', label: '正式环境' } } }
const sha = 'a'.repeat(40)
it('local development does not pretend to be a release', () => {
  expect(createDeploymentMetadata(contract)).toMatchObject({ environment: 'local', displayVersion: '未发布' })
})
it('binds the selected environment to its canonical domain', () => {
  const preview = createDeploymentMetadata(contract, 'preview', '1.2.0@aaaaaaaaaaaa', sha)
  expect(preview.origin).toBe('https://prev.yangtzeu.work')
  expect(deploymentDisplay(preview, 'prev.yangtzeu.work').label).toBe('预发布环境')
  expect(deploymentDisplay(preview, 'yangtzeu.work').configurationMismatch).toBe(true)
  expect(deploymentDisplay(preview, '127.0.0.1').label).toBe('本地开发')
})
it.each([
  ['production', '1.2.0@aaaaaaaaaaaa', sha],
  ['preview', '1.2.0@bbbbbbbbbbbb', sha],
  ['preview', '1.2.0', 'short'],
  ['production', '', sha],
  ['prev', '1.2.0', sha],
])('rejects invalid release metadata %s %s', (environment, version, commit) => {
  expect(() => createDeploymentMetadata(contract, environment, version, commit)).toThrow()
})
it('production uses a bare version without a commit suffix', () => {
  const value = createDeploymentMetadata(contract, 'production', '1.2.0', sha)
  expect(value.origin).toBe('https://yangtzeu.work')
  expect(deploymentDisplay(value, 'yangtzeu.work').configurationMismatch).toBe(false)
})
