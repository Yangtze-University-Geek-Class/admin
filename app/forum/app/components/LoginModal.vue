<script setup lang="ts">
import { toast } from '@talex-touch/tuffex/utils'
import type { User } from '~/data/types'

// Mock sign-in: pick any seeded user. Mounted once, in the default layout.
// In snapshot mode the same trigger opens a read-only notice instead: the
// store then holds real members, and none of them may be impersonated.
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
  <TxModal v-if="isSnapshot" v-model="loginOpen" title="只读快照，暂不开放登录">
    <TxStack :gap="12">
      <p class="text-$tx-text-color-secondary">
        当前显示的是极客班论坛的只读快照。发帖、回复、点赞、收藏和资料修改要等真实后端与统一登录接入后才会开放。
      </p>
      <TxFlex justify="flex-end">
        <TxButton variant="primary" @click="loginOpen = false">
          知道了
        </TxButton>
      </TxFlex>
    </TxStack>
  </TxModal>
  <TxModal v-else v-model="loginOpen" title="选择一个身份登录">
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
