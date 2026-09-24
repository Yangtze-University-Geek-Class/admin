<script setup lang="ts">
import { toast } from '@talex-touch/tuffex/utils'
import type { User } from '~/data/types'

// Mock sign-in: pick any seeded user. Mounted once, in the default layout.
// 真实数据模式没有论坛自己的登录（全站统一走 GitHub 登录，入口在顶栏右上角），这里什么也不渲染；store 里是真实成员，谁都不能冒充。
const { loginOpen } = useShell()
const { isSnapshot } = useContentSource()
const forum = useForumStore()
const session = useSessionStore()

function pick(user: User) {
  if (!session.login(user.id))
    return
  loginOpen.value = false
  toast({ title: `已切换为 ${user.displayName}`, variant: 'success' })
}
</script>

<template>
  <TxModal v-if="!isSnapshot" v-model="loginOpen" title="选择一个身份登录">
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
