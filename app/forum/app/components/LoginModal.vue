<script setup lang="ts">
import { toast } from '@talex-touch/tuffex/utils'
import type { User } from '~/data/types'

// Mock sign-in: pick any seeded user. Mounted once, in the default layout.
// 统一登录下论坛没有自己的登录（全站走 GitHub 登录，入口在顶栏右上角），示例身份选择不渲染，谁都不能冒充。
// 这时点赞、书签、关注等要求登录的按钮仍会打开 loginOpen：给一句说明再关上，不让点击没有反应。
const { loginOpen } = useShell()
const { siteLogin } = useContentSource()
const forum = useForumStore()
const session = useSessionStore()

if (siteLogin) {
  watch(loginOpen, (open) => {
    if (!open)
      return
    loginOpen.value = false
    toast({ id: 'forum-read-only', title: '现在还不能操作', description: '发帖、回复、点赞和收藏正在接入，现在可以浏览。' })
  })
}

function pick(user: User) {
  if (!session.login(user.id))
    return
  loginOpen.value = false
  toast({ title: `已切换为 ${user.displayName}`, variant: 'success' })
}
</script>

<template>
  <TxModal v-if="!siteLogin" v-model="loginOpen" title="选择一个身份登录">
    <TxStack :gap="4" class="max-h-[60vh] overflow-y-auto">
      <TxCardItem
        v-for="user in forum.state.users"
        :key="user.id"
        clickable
        :active="user.id === session.currentUserId"
        :title="user.displayName"
        :subtitle="`@${user.username}`"
        @click="pick(user)"
      >
        <template #avatar>
          <UserAvatar :user="user" size="small" />
        </template>
        <template v-if="user.role !== 'member'" #right>
          <TxStatusBadge :text="roleLabel(user.role)" :status="roleTone(user.role)" size="sm" />
        </template>
      </TxCardItem>
    </TxStack>
  </TxModal>
</template>
