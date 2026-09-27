<script setup lang="ts">
import type { PromptToast } from '~/data/access'
import { toast } from '@talex-touch/tuffex/utils'
import { loginPromptToast, refusedNotMemberToast, signinLapsedToast } from '~/data/access'
import type { User } from '~/data/types'

// Mock sign-in: pick any seeded user. Mounted once, in the default layout.
// 统一登录下论坛没有自己的登录（全站走 GitHub 登录，入口在顶栏右上角），示例身份选择不渲染，谁都不能冒充。
// 这时点赞、书签、关注等要求登录的按钮仍会打开 loginOpen：给一句说明再关上，不让点击没有反应。
// 极客班论坛里说明要登录，并直接给登录按钮；论坛服务连不上时说明只能看帖子；快照只能看。说什么在 data/access.ts 的 loginPromptToast。
// 登录没了（服务端因为 GitHub 收回了会话里的授权而结束了它，或会话在别的标签页结束、到期，#164）：头像菜单换回登录按钮，
// 页面按游客重读，toast 说一次并给「登录」。成员写操作碰到的普通 401 也可能是被移出了组织，先问一次 /auth/me：还登录着就说哪件事没成、这个账号不在组织里。
const { loginOpen } = useShell()
const { siteLogin, serverMode } = useContentSource()
const { access } = useCurrentUser()
const { account, refresh } = useSiteAccount()
const { signIn } = useSiteLinks()
const forum = useForumStore()
const session = useSessionStore()

function say({ signIn: withSignIn, ...copy }: PromptToast): void {
  toast({ ...copy, ...(withSignIn ? { action: { label: '登录', onClick: signIn } } : {}) })
}

if (siteLogin) {
  watch(loginOpen, (open) => {
    if (!open)
      return
    loginOpen.value = false
    say(loginPromptToast(access.value.loginPrompt))
  })
}

if (serverMode) {
  const server = useForumServerStore()
  // 首次读状态在挂载前（site-state.client.ts），那时结束的登录要在这里补说；记下说到第几次，重新挂载也不重复。
  const said = useState<number>('forum:signin-lapse-said', () => 0)
  watch(() => server.signinLapse, async (lapse) => {
    if (lapse.count <= said.value)
      return
    said.value = lapse.count
    if (!lapse.ended) {
      // /auth/me 回来之前先按没登录算，页面不会先说「这个账号不在组织里」。
      account.value = null
      await refresh()
      if (account.value && lapse.failed) {
        say(refusedNotMemberToast(lapse.failed))
        return
      }
    }
    account.value = null
    say(signinLapsedToast(lapse.failed))
  }, { immediate: true })
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
