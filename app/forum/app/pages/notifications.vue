<script setup lang="ts">
// Discourse's /notifications, which is the shared list on its own page.
useHead({ title: '通知' })

const { user, isLoggedIn } = useCurrentUser()
</script>

<template>
  <TxCard>
    <template #header>
      <h1 class="text-xl font-semibold">
        通知
      </h1>
    </template>

    <NotificationList v-if="user" :user-id="user.id" />

    <SignInState v-else-if="!isLoggedIn" page="notifications" />
  </TxCard>
</template>
