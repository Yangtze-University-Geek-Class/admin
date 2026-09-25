<script setup lang="ts">
const deployment = useDeploymentInfo()
const { isSnapshot, isSite } = useContentSource()
const contentNote = computed(() => {
  // 极客班论坛的状态顶部提示已经说了，这里不再重复
  if (isSite)
    return ''
  return isSnapshot ? '当前页面显示极客班论坛的帖子，发帖与回复还没接入。' : '当前页面仍使用上游示例内容。'
})
</script>

<template>
  <TxCard>
    <template #header>
      <h2 class="text-lg font-semibold">运行环境与发布信息</h2>
    </template>
    <TxStack :gap="12">
      <TxFlex :gap="8" align="center" wrap="wrap">
        <TxStatusBadge :text="deployment.label" :status="deployment.environment === 'production' && !deployment.configurationMismatch ? 'success' : 'warning'" />
        <span>版本：{{ deployment.displayVersion }}</span>
      </TxFlex>
      <p v-if="deployment.commit" class="break-all text-sm text-$tx-text-color-secondary">构建提交：{{ deployment.commit }}</p>
      <p>预发布：<a :href="deployment.previewOrigin" class="text-$tx-color-primary underline" target="_blank" rel="noopener noreferrer">prev.yangtzeu.work</a>，由打在 <code>stage</code> 提交上的 <code>vX.Y.Z-rc.N</code> tag 发布，版本显示为 X.Y.Z-rc.N@提交前 12 位。</p>
      <p>正式：<a :href="deployment.productionOrigin" class="text-$tx-color-primary underline" target="_blank" rel="noopener noreferrer">yangtzeu.work</a>，预发布验收通过后，由打在同一提交上的 <code>vX.Y.Z</code> tag 发布，版本显示为 X.Y.Z。推送分支本身不会发布。</p>
      <p class="text-sm text-$tx-text-color-secondary">本地预览不是预发布环境。环境信息和测试通过均不代表人工批准{{ contentNote ? `；${contentNote}` : '。' }}</p>
      <TxAlert v-if="deployment.configurationMismatch" type="error" message="当前域名与构建声明不一致，请停止发布并检查环境配置。" />
    </TxStack>
  </TxCard>
</template>
