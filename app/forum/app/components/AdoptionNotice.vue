<script setup lang="ts">
import { UNAVAILABLE_COPY } from '~/data/access'
import { SITE_NOTICE } from '../../shared/site-notice'

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
          <!-- 极客班论坛：连不上或请求太频繁时整句换成原因；平时是现状，没登录的人再多一句能做什么（与 llms.txt 同一份文字，shared/site-notice.ts） -->
          <span v-if="isSite && (access.loginPrompt === 'offline' || access.loginPrompt === 'busy')" class="text-$tx-text-color-secondary leading-normal">
            {{ UNAVAILABLE_COPY[access.loginPrompt].title }}，{{ UNAVAILABLE_COPY[access.loginPrompt].description }}
          </span>
          <span v-else-if="isSite" class="text-$tx-text-color-secondary leading-normal">
            {{ SITE_NOTICE.published }}<template v-if="loaded && !account">{{ SITE_NOTICE.guests }}</template>
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
