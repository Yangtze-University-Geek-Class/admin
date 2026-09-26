<script setup lang="ts">
// Wraps the page area: in demo mode it is transparent; in snapshot mode it
// holds the pages back until the archive is loaded and surfaces a failure
// instead of letting the seed leak through. Against the forum server it holds
// them until the server answered or failed (a topic started yesterday is not
// in the build, and its page must not 404 while the state is on its way).
const { snapshot, ready, load } = useContentSource()
</script>

<template>
  <slot v-if="ready" />

  <TxCard v-else-if="snapshot.status === 'error'" role="alert">
    <TxStack :gap="12">
      <!-- 排查步骤（快照目录、dev.log）写在 docs/ops/TUFF-FORUM.md，页面上只说结果和错误码 -->
      <TxAlert type="error" title="极客班论坛的帖子没有加载出来" :message="snapshot.error" :closable="false" />
      <p class="text-sm text-$tx-text-color-secondary">
        页面不会改用示例内容。可以点「重试」，还不行就把上面的错误码发给维护者。
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
