<script setup lang="ts">
// Discourse's /notifications, which is the shared list on its own page.
useHead({ title: '通知' })

const { user, isLoggedIn } = useCurrentUser()
const { loginOpen } = useShell()
const { isSnapshot } = useContentSource()
</script>

<template>
  <TxCard>
    <template #header>
      <h1 class="text-xl font-semibold">
        通知
      </h1>
    </template>

    <NotificationList v-if="user" :user-id="user.id" />

    <TxEmptyState
      v-else-if="!isLoggedIn"
      variant="permission"
      :title="isSnapshot ? '通知还没开放' : '登录后才能查看通知'"
      :description="isSnapshot ? '通知正在接入，接好后用官网的 GitHub 登录就能用。' : '通知属于某个身份，先选一个再回来。'"
      :primary-action="isSnapshot ? undefined : { label: '登录', variant: 'primary' }"
      @primary="loginOpen = true"
    />
  </TxCard>
</template>
