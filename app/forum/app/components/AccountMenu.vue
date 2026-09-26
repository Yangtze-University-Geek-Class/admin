<script setup lang="ts">
import type { AccountMenuKey } from '~/data/account-menu'
import type { SiteAccount } from '~/composables/useSiteAccount'
import { accountMenu } from '~/data/account-menu'

// The avatar menu under the site-wide login. The rows come from
// `accountMenu` (data/account-menu.ts, unit-tested); here they only get
// rendered and routed. The header row is a plain TxCardItem, not a disabled
// menu item: it is not an action, keyboard focus skips it, and there is no
// TxDivider — inside the menu panel a divider keeps its 16px page margins
// and reads as an empty row.
const props = defineProps<{ account: SiteAccount }>()

const router = useRouter()
const forum = useForumStore()
const { user } = useCurrentUser()
const { signOut } = useSiteAccount()
const { consoleHref, portalHref, leave } = useSiteLinks()

const menu = computed(() => accountMenu({ login: props.account.login, consoleLink: props.account.consoleLink, user: user.value }))
const unread = computed(() => (user.value ? forum.unreadCount(user.value.id) : 0))

function run(key: AccountMenuKey) {
  const current = user.value
  switch (key) {
    case 'profile':
      if (current)
        void router.push(`/u/${current.username}`)
      return
    case 'preferences':
      if (current)
        void router.push(`/u/${current.username}/preferences`)
      return
    case 'bookmarks':
      void router.push('/bookmarks')
      return
    case 'notifications':
      void router.push('/notifications')
      return
    case 'console':
      leave(consoleHref)
      return
    case 'portal':
      leave(portalHref.value)
      return
    case 'about':
      void router.push('/about')
      return
    case 'signout':
      void signOut()
  }
}
</script>

<template>
  <TxDropdownMenu placement="bottom-end">
    <template #trigger>
      <TxIconButton :label="`@${account.login}`" shape="circle">
        <UserAvatar v-if="user" :user="user" size="small" />
        <TxAvatar v-else :src="account.avatarUrl ?? undefined" :name="account.login" size="small" />
      </TxIconButton>
    </template>

    <TxCardItem :title="menu.title" :subtitle="menu.subtitle || undefined">
      <template #avatar>
        <UserAvatar v-if="user" :user="user" size="small" />
        <TxAvatar v-else :src="account.avatarUrl ?? undefined" :name="account.login" size="small" />
      </template>
    </TxCardItem>

    <TxDropdownItem v-for="item in menu.items" :key="item.key" :danger="item.danger" @select="run(item.key)">
      <span class="inline-flex items-center gap-2">
        <i :class="item.icon" aria-hidden="true" />
        <span>{{ item.label }}</span>
      </span>
      <template v-if="item.key === 'notifications' && unread > 0" #right>
        <TxBadge variant="primary" :value="unread" />
      </template>
    </TxDropdownItem>
  </TxDropdownMenu>
</template>
