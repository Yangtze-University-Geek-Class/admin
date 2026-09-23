export type DeploymentEnvironment = 'local' | 'preview' | 'production'
export interface DeploymentMetadata {
  environment: DeploymentEnvironment
  label: string
  origin: string
  displayVersion: string
  commit: string
  previewOrigin: string
  productionOrigin: string
}
interface Contract { environments: Record<'preview' | 'production', { label: string, origin: string }> }

/** Metadata is for display, not proof of human acceptance or permission to publish. */
export function createDeploymentMetadata(contract: Contract, environment = 'local', displayVersion = '', commit = ''): DeploymentMetadata {
  if (!['local', 'preview', 'production'].includes(environment))
    throw new Error('Unknown deployment environment')
  const previewOrigin = contract.environments.preview.origin
  const productionOrigin = contract.environments.production.origin
  if (previewOrigin !== 'https://prev.yangtzeu.work' || productionOrigin !== 'https://yangtzeu.work')
    throw new Error('Deployment domain contract mismatch')
  if (environment === 'local')
    return { environment, label: '本地开发', origin: '', displayVersion: '未发布', commit: '', previewOrigin, productionOrigin }
  // Releases are cut from tags (docs/conventions/RELEASES.md): production shows the bare
  // `X.Y.Z` of tag vX.Y.Z; preview shows `X.Y.Z-rc.N@<sha12>` of tag vX.Y.Z-rc.N. The `-rc.N`
  // part is only valid together with the `@<sha12>` suffix, and preview needs both.
  const version = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-rc\.[1-9]\d*@([a-f0-9]{12}))?$/
  const match = displayVersion.match(version)
  const isPreviewShape = Boolean(match?.[1])
  if (!match || !/^[a-f0-9]{40}$/.test(commit) || isPreviewShape !== (environment === 'preview') || (isPreviewShape && match[1] !== commit.slice(0, 12)))
    throw new Error('Release metadata must bind version, environment and exact commit')
  const selected = contract.environments[environment as 'preview' | 'production']
  return { environment: environment as DeploymentEnvironment, label: selected.label, origin: selected.origin, displayVersion, commit, previewOrigin, productionOrigin }
}

export function deploymentDisplay(metadata: DeploymentMetadata, hostname: string) {
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)
  const mismatch = !local && (!metadata.origin || new URL(metadata.origin).hostname !== hostname)
  return {
    ...metadata,
    label: local ? '本地开发' : mismatch ? '环境配置不匹配' : metadata.label,
    displayVersion: local ? '未发布' : metadata.displayVersion,
    configurationMismatch: mismatch,
  }
}
