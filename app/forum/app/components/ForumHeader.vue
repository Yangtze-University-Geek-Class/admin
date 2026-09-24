<script setup lang="ts">
// Discourse's top bar: logo, search, sidebar toggle, theme, notifications and
// the user menu. "New topic" deliberately lives in the topic-list nav row.
const { isDesktop, loginOpen, toggleSidebar } = useShell()
const { siteName, isSnapshot } = useContentSource()
const { account, loaded, signOut } = useSiteAccount()
const route = useRoute()
const { absoluteUrl } = useAppLink()
/** 统一登录：走核心服务的 GitHub 登录，登录后回到当前论坛页面。本机开发时统一登录在官网 5173 上。 */
const signInHref = computed(() => {
  const portal = import.meta.dev ? 'http://127.0.0.1:5173' : ''
  const back = import.meta.dev ? `${portal}/forum${route.fullPath}` : absoluteUrl({ path: route.fullPath })
  return `${portal}/auth/github?return_to=${encodeURIComponent(back)}`
})
const { user } = useCurrentUser()
const session = useSessionStore()
const forum = useForumStore()
const router = useRouter()
const colorMode = useColorMode()

const query = ref('')
const isDark = computed(() => colorMode.value === 'dark')
const unread = computed(() => (user.value ? forum.unreadCount(user.value.id) : 0))
const shortcutHint = import.meta.client && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'

function go(path: string) {
  void router.push(path)
}

function search(value: string) {
  const q = value.trim()
  if (q)
    go(`/search?q=${encodeURIComponent(q)}`)
}

function toggleTheme() {
  colorMode.preference = isDark.value ? 'light' : 'dark'
}

function logout() {
  session.logout()
  go('/')
}

function goSignIn() {
  window.location.assign(signInHref.value)
}

/** 控制台在同域的 `/console`，不经论坛的路由器 */
function openConsole() {
  window.location.assign('/console')
}
</script>

<template>
  <header class="sticky top-0 z-30 border-b border-$tx-border-color-light bg-$tx-bg-color">
    <TxContainer max-width="1400px">
      <TxFlex align="center" :gap="12" class="h-14">
        <NuxtLink to="/" class="inline-flex items-center gap-2 text-inherit no-underline">
          <TxTuffLogoStroke :size="28" mode="hover" />
          <span class="text-lg font-semibold">{{ siteName }}</span>
        </NuxtLink>

        <TxFlex align="center" :gap="8" class="ml-auto">
          <TxFlex v-if="isDesktop" align="center" :gap="6" class="w-64">
            <TxSearchInput
              v-model="query"
              placeholder="搜索"
              clearable
              @search="search"
            />
            <TxKbd size="sm">
              {{ shortcutHint }}
            </TxKbd>
          </TxFlex>
          <TxIconButton
            v-else
            icon="i-carbon-search"
            label="搜索"
            @click="go('/search')"
          />

          <TxIconButton icon="i-carbon-menu" label="切换侧栏" @click="toggleSidebar" />
          <TxIconButton
            :icon="isDark ? 'i-carbon-sun' : 'i-carbon-moon'"
            label="切换主题"
            @click="toggleTheme"
          />

          <template v-if="user">
            <span class="relative inline-flex">
              <TxIconButton icon="i-carbon-notification" label="通知" @click="go('/notifications')" />
              <TxBadge
                variant="primary"
                :value="unread"
                :open="unread > 0"
                class="pointer-events-none absolute -right-1 -top-1"
              />
            </span>

            <TxDropdownMenu placement="bottom-end">
              <template #trigger>
                <TxIconButton label="用户菜单" shape="circle">
                  <UserAvatar :user="user" size="small" />
                </TxIconButton>
              </template>
              <TxDropdownItem @select="go(`/u/${user.username}`)">
                我的主页
              </TxDropdownItem>
              <TxDropdownItem @select="go(`/u/${user.username}?tab=activity`)">
                我的帖子
              </TxDropdownItem>
              <TxDropdownItem @select="go('/bookmarks')">
                书签
              </TxDropdownItem>
              <TxDropdownItem @select="go(`/u/${user.username}/preferences`)">
                偏好设置
              </TxDropdownItem>
              <TxDivider />
              <TxDropdownItem @select="loginOpen = true">
                切换用户
              </TxDropdownItem>
              <TxDropdownItem danger @select="logout">
                退出登录
              </TxDropdownItem>
            </TxDropdownMenu>
          </template>

          <!-- 真实数据：只有这一个登录入口，走全站统一的 GitHub 登录（同一个 cookie）；登录后显示头像，不登录也能以游客身份看帖子。 -->
          <template v-else-if="isSnapshot">
            <TxDropdownMenu v-if="account" placement="bottom-end">
              <template #trigger>
                <TxIconButton :label="`@${account.login}`" shape="circle">
                  <TxAvatar :src="account.avatarUrl ?? undefined" :name="account.login" size="small" />
                </TxIconButton>
              </template>
              <TxDropdownItem disabled>
                @{{ account.login }}
              </TxDropdownItem>
              <TxDivider />
              <TxDropdownItem @select="openConsole">
                控制台
              </TxDropdownItem>
              <TxDropdownItem danger @select="signOut">
                退出
              </TxDropdownItem>
            </TxDropdownMenu>
            <TxButton v-else-if="loaded" variant="primary" size="sm" icon="i-carbon-logo-github" @click="goSignIn">
              用 GitHub 登录
            </TxButton>
          </template>
          <TxButton v-else variant="primary" size="sm" @click="loginOpen = true">
            登录
          </TxButton>
        </TxFlex>
      </TxFlex>
    </TxContainer>
  </header>
</template>
