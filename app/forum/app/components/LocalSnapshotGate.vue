<script setup lang="ts">
// Wraps the page area: in demo mode it is transparent; in snapshot mode it
// holds the pages back until the archive is loaded and surfaces a failure
// instead of letting the seed leak through.
const { snapshot, ready, load } = useContentSource()
</script>

<template>
  <slot v-if="ready" />

  <TxCard v-else-if="snapshot.status === 'error'" role="alert">
    <TxStack :gap="12">
      <TxAlert type="error" title="无法加载极客班论坛快照" :message="snapshot.error" :closable="false" />
      <p class="text-sm text-$tx-text-color-secondary">
        页面不会回退到上游示例内容。请检查 GEEK_FORUM_CONTENT_DIR 指向的快照目录是否完整，或查看 .tools/tuff-forum/dev.log。
      </p>
      <TxFlex :gap="8">
        <TxButton variant="primary" icon="i-carbon-renew" @click="load">
          重试
        </TxButton>
      </TxFlex>
    </TxStack>
  </TxCard>

  <TxCard v-else role="status" aria-live="polite">
    <TxStack :gap="12">
      <p class="text-sm text-$tx-text-color-secondary">
        正在加载极客班论坛…
      </p>
      <TxSkeleton :lines="6" />
    </TxStack>
  </TxCard>
</template>
