<script setup lang="ts">
import dayjs from 'dayjs'

const deployment = useDeploymentInfo()
const { isSnapshot, snapshot } = useContentSource()
const portal = computed(() => import.meta.dev ? 'http://127.0.0.1:5173/sites/portal/' : deployment.value.origin || '/')
const capturedAt = computed(() => snapshot.value.capturedAt ? dayjs(snapshot.value.capturedAt).format('YYYY-MM-DD HH:mm') : '')
</script>

<template>
  <TxContainer max-width="1400px" class="pt-3">
    <TxCard>
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm">
        <div class="flex flex-wrap items-center gap-2">
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
        </div>
        <div class="flex items-center gap-4 shrink-0 whitespace-nowrap pt-1 sm:pt-0">
          <a :href="portal" class="text-$tx-color-primary underline">返回宣传主页</a>
          <NuxtLink to="/about" class="text-$tx-color-primary underline">查看环境与版本</NuxtLink>
        </div>
      </div>
    </TxCard>
  </TxContainer>
</template>
