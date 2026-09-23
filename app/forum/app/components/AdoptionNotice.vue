<script setup lang="ts">
import dayjs from 'dayjs'

const deployment = useDeploymentInfo()
const { isSnapshot, snapshot } = useContentSource()
const portal = computed(() => import.meta.dev ? 'http://127.0.0.1:5173/sites/portal/' : deployment.value.origin || '/')
const capturedAt = computed(() => snapshot.value.capturedAt ? dayjs(snapshot.value.capturedAt).format('YYYY-MM-DD HH:mm') : '')
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
          <span v-if="isSnapshot" class="text-$tx-text-color-secondary leading-normal">
            当前数据：极客班论坛只读快照<template v-if="capturedAt">，采集于 {{ capturedAt }}</template>。尚未接入真实登录与后端，暂不能发帖、回复或修改资料。
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
