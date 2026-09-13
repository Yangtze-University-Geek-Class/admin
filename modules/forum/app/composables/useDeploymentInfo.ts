import type { DeploymentMetadata } from '../../shared/deployment'
import { deploymentDisplay } from '../../shared/deployment'

export function useDeploymentInfo() {
  const config = useRuntimeConfig()
  return computed(() => deploymentDisplay(
    config.public.siteDeployment as DeploymentMetadata,
    import.meta.client ? window.location.hostname : '',
  ))
}
