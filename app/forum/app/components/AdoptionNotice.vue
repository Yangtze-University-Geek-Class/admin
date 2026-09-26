<script setup lang="ts">
const deployment = useDeploymentInfo()
const { isSnapshot, isSite, siteLogin } = useContentSource()
const { access } = useCurrentUser()
// 已经登录的人不再提示去右上角登录（与顶栏共用同一份 /auth/me 结果）；
// 等 /auth/me 返回再显示，和顶栏的登录按钮同时出现，已登录的人不会先看到再消失
const { account, loaded } = useSiteAccount()
// 统一登录下「返回宣传主页」「查看环境与版本」在头像菜单里（游客的宣传主页在侧栏「社区」，版本在「关于」）；
// 示例登录没有那个菜单，两个链接留在这里。
const { portalHref } = useSiteLinks()
</script>

<template>
  <TxContainer max-width="1400px" class="pt-3">
    <!--
      A standing notice, composed from TxCard + TxFlex rather than TxAlert: the
      upstream topic-page suite treats the first .tx-alert outside a post as the
      topic control bar, and a page-wide alert would also be announced
      assertively (role="alert") on every load.
    -->
    <TxCard>
      <TxFlex align="center" justify="space-between" :gap="12" wrap="wrap" class="text-sm">
        <TxFlex align="center" :gap="8" wrap="wrap">
          <TxStatusBadge
            :text="`${deployment.label} · ${deployment.displayVersion}`"
            :status="isSnapshot || isSite ? 'info' : 'warning'"
            size="sm"
            class="shrink-0 whitespace-nowrap"
          />
          <span v-if="isSite && access.offline" class="text-$tx-text-color-secondary leading-normal">
            论坛服务暂时连不上，现在只能看帖子。
          </span>
          <span v-else-if="isSite" class="text-$tx-text-color-secondary leading-normal">
            旧论坛先放出了招新机试文档和入门资料，其余旧帖暂时不显示。<template v-if="loaded && !account">不登录也能看帖和回复；发新话题、点赞和收藏要先在右上角用 GitHub 登录，只有极客班成员能登录。</template>
          </span>
          <span v-else-if="siteLogin" class="text-$tx-text-color-secondary leading-normal">
            {{ isSnapshot ? '发帖和回复正在接入，现在可以浏览。' : '当前是示例帖子，极客班的帖子还没接入。' }}极客班成员可以在右上角用 GitHub 登录，官网、论坛、控制台共用这一次登录；不登录也能看帖子。
          </span>
          <span v-else class="text-$tx-text-color-secondary leading-normal">
            当前数据：上游示例，尚未接通极客班真实帖子。示例身份不是真实登录，请勿填写敏感资料。
          </span>
        </TxFlex>
        <TxFlex v-if="!siteLogin" align="center" :gap="16" class="shrink-0 whitespace-nowrap">
          <a :href="portalHref" class="text-$tx-color-primary underline">返回宣传主页</a>
          <NuxtLink to="/about" class="text-$tx-color-primary underline">查看环境与版本</NuxtLink>
        </TxFlex>
      </TxFlex>
    </TxCard>
  </TxContainer>
</template>
