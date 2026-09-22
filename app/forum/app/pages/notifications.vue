<script setup lang="ts">
// Discourse's /notifications, which is the shared list on its own page.
useHead({ title: '通知' })

const { user, isLoggedIn } = useCurrentUser()
const { loginOpen } = useShell()
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
      title="登录后才能查看通知"
      description="通知属于某个身份，先选一个再回来。"
      :primary-action="{ label: '登录', variant: 'primary' }"
      @primary="loginOpen = true"
    />
  </TxCard>
</template>
