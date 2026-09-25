<script setup lang="ts">
const deployment = useDeploymentInfo()
const { isSnapshot, siteLogin } = useContentSource()
const portal = computed(() => import.meta.dev ? 'http://127.0.0.1:5173/sites/portal/' : deployment.value.origin || '/')
</script>

<template>
  <TxContainer max-width="1400px" class="pt-3">
    <!--
      A standing notice, composed from TxCard + TxFlex rather than TxAlert: the
      upstream topic-page suite treats the first .tx-alert outside a post as the
      topic control bar, and a page-wide alert would also be announced
      assertively (role="alert") on every load.
    -->
    <TxCard>
      <TxFlex align="center" justify="space-between" :gap="12" wrap="wrap" class="text-sm">
        <TxFlex align="center" :gap="8" wrap="wrap">
          <TxStatusBadge
            :text="`${deployment.label} · ${deployment.displayVersion}`"
            :status="isSnapshot ? 'info' : 'warning'"
            size="sm"
            class="shrink-0 whitespace-nowrap"
          />
          <span v-if="siteLogin" class="text-$tx-text-color-secondary leading-normal">
            {{ isSnapshot ? '发帖和回复正在接入，现在可以浏览。' : '当前是示例帖子，极客班的帖子还没接入。' }}极客班成员可以在右上角用 GitHub 登录，官网、论坛、控制台共用这一次登录；不登录也能看帖子。
          </span>
          <span v-else class="text-$tx-text-color-secondary leading-normal">
            当前数据：上游示例，尚未接通极客班真实帖子。示例身份不是真实登录，请勿填写敏感资料。
          </span>
        </TxFlex>
        <TxFlex align="center" :gap="16" class="shrink-0 whitespace-nowrap">
          <a :href="portal" class="text-$tx-color-primary underline">返回宣传主页</a>
          <NuxtLink to="/about" class="text-$tx-color-primary underline">查看环境与版本</NuxtLink>
        </TxFlex>
      </TxFlex>
    </TxCard>
  </TxContainer>
</template>
