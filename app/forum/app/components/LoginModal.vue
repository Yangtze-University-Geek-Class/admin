<script setup lang="ts">
import { toast } from '@talex-touch/tuffex/utils'
import type { User } from '~/data/types'

// Mock sign-in: pick any seeded user. Mounted once, in the default layout.
// 统一登录下论坛没有自己的登录（全站走 GitHub 登录，入口在顶栏右上角），示例身份选择不渲染，谁都不能冒充。
// 这时点赞、书签、关注等要求登录的按钮仍会打开 loginOpen：给一句说明再关上，不让点击没有反应。
// 极客班论坛里说明要登录，并直接给登录按钮；论坛服务连不上时说明只能看帖子；快照只能看。
const { loginOpen } = useShell()
const { siteLogin } = useContentSource()
const { access } = useCurrentUser()
const { signIn } = useSiteLinks()
const forum = useForumStore()
const session = useSessionStore()

if (siteLogin) {
  watch(loginOpen, (open) => {
    if (!open)
      return
    loginOpen.value = false
    if (access.value.loginPrompt === 'sign-in') {
      toast({
        id: 'forum-sign-in',
        title: '登录后才能继续',
        description: '发新话题、点赞、收藏和关注要先用 GitHub 登录，只有极客班成员能登录。不登录也能看帖和回复。',
        duration: 6000,
        action: { label: '登录', onClick: signIn },
      })
    }
    else if (access.value.loginPrompt === 'offline') {
      toast({ id: 'forum-offline', title: '论坛服务暂时连不上', description: '现在只能看帖子，稍后刷新页面再试。', variant: 'warning' })
    }
    else {
      toast({ id: 'forum-read-only', title: '现在还不能操作', description: '发帖、回复、点赞和收藏正在接入，现在可以浏览。' })
    }
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
