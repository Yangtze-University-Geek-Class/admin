<script setup lang="ts">
// Discourse's top bar: logo, search, sidebar toggle, theme, notifications and
// the user menu. "New topic" deliberately lives in the topic-list nav row.
const { isDesktop, loginOpen, toggleSidebar } = useShell()
const { siteName, siteLogin } = useContentSource()
const { account, loaded } = useSiteAccount()
const { signIn } = useSiteLinks()
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
</script>

<template>
  <header class="sticky top-0 z-30 border-b border-$tx-border-color-light bg-$tx-bg-color">
    <TxContainer max-width="1400px">
      <TxFlex align="center" :gap="12" class="h-14">
        <!--
          The 极客班 logo, same public file the sidebar used to show. A literal
          `src` so the build rewrites it under app.baseURL (/forum/logo.png in
          the image). Decorative: the link's name is the visible site name.
        -->
        <NuxtLink to="/" class="inline-flex items-center gap-2 text-inherit no-underline">
          <img src="/logo.png" alt="" class="block h-7 w-7 shrink-0 object-contain">
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

          <!-- 通知铃：示例登录选了身份的人，和极客班论坛里登录的成员 -->
          <span v-if="user" class="relative inline-flex">
            <TxIconButton icon="i-carbon-notification" label="通知" @click="go('/notifications')" />
            <TxBadge
              variant="primary"
              :value="unread"
              :open="unread > 0"
              class="pointer-events-none absolute -right-1 -top-1"
            />
          </span>

          <template v-if="!siteLogin && user">
            <TxDropdownMenu placement="bottom-end">
              <template #trigger>
                <TxIconButton label="用户菜单" shape="circle">
                  <UserAvatar :user="user" size="small" />
                </TxIconButton>
              </template>
              <!-- 账号只在这里显示（侧栏不再有账号卡片），和统一登录的菜单一样先写是谁 -->
              <TxDropdownItem disabled>
                @{{ user.username }} · {{ roleLabel(user.role) }}
              </TxDropdownItem>
              <TxDivider />
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

          <!--
            统一登录：只有这一个登录入口，走全站统一的 GitHub 登录（同一个 cookie）；登录后是头像菜单
            （AccountMenu：主页、资料、书签、通知、按权限出现的控制台、宣传主页、环境与版本、退出），
            不登录也能以游客身份看帖子，极客班论坛里还能回复。
          -->
          <template v-else-if="siteLogin">
            <AccountMenu v-if="account" :account="account" />
            <!-- 手机顶栏放不下完整文字，只写「登录」，读屏仍读完整说明 -->
            <TxButton v-else-if="loaded" variant="primary" size="sm" icon="i-carbon-logo-github" :aria-label="isDesktop ? undefined : '用 GitHub 登录'" @click="signIn">
              {{ isDesktop ? '用 GitHub 登录' : '登录' }}
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
