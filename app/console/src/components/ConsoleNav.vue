<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { TxSidebarNav } from "@talex-touch/tuffex/sidebar-nav";
import type { SidebarNavItem } from "@talex-touch/tuffex/sidebar-nav";
import { TxCardItem } from "@talex-touch/tuffex/card-item";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxAvatar } from "@talex-touch/tuffex/avatar";
import TitleBadge from "./TitleBadge.vue";
import logoUrl from "../assets/logo.png";
import { BLOCK_REASON_TEXT, NAV_GROUPS, activeNavId, visibleNav } from "../lib/nav";
import { siteUrl } from "../lib/runtime";
import type { ConsoleMe } from "../lib/types";

/**
 * 控制台导航：TxSidebarNav。被 GitHub 组织角色挡住的项渲染为禁用，并在名字后写明原因。
 * 桌面是左侧栏；窄屏放在 TxDrawer 里（见 ConsoleShell.vue），`navigate` 让抽屉在选中后关闭。
 */
const props = defineProps<{ me: ConsoleMe }>();
const emit = defineEmits<{ navigate: []; signout: [] }>();
const route = useRoute();
const router = useRouter();
const query = ref("");

const entries = computed(() => visibleNav(props.me));
const items = computed<SidebarNavItem[]>(() => entries.value.map(item => ({
  value: item.id,
  label: item.state === "disabled" && item.reason ? `${item.label}（${BLOCK_REASON_TEXT[item.reason]}）` : item.label,
  group: item.group,
  icon: item.state === "disabled" ? "i-carbon-locked" : item.icon,
  disabled: item.state === "disabled",
})));
const groups = computed(() => NAV_GROUPS);
const active = computed(() => activeNavId(route.path) ?? "");
const workspace = computed(() => ({ name: "极客班控制台", description: props.me.org }));

function openSite(target: "portal" | "forum") {
  window.location.assign(siteUrl(target, "/"));
}

function onSelect(item: SidebarNavItem) {
  const target = entries.value.find(entry => entry.id === item.value);
  if (!target || target.state !== "visible") return;
  void router.push(target.to);
  emit("navigate");
}
</script>

<template>
  <div class="console-nav">
    <TxSidebarNav
      v-model:query="query"
      :model-value="active"
      :items="items"
      :groups="groups"
      :workspace="workspace"
      aria-label="控制台导航"
      @select="onSelect"
    >
      <template #workspace>
        <TxCardItem clickable role="link" :title="workspace.name" :subtitle="workspace.description" class="console-nav__brand" @click="onSelect({ value: 'overview', label: '概览' })">
          <template #avatar>
            <img :src="logoUrl" alt="" class="console-nav__logo" width="32" height="32">
          </template>
        </TxCardItem>
      </template>

      <template #item-icon="{ item }">
        <i v-if="item.icon" :class="item.icon" aria-hidden="true" />
      </template>

      <template #footer>
        <div class="console-nav__footer">
          <div class="console-nav__me">
            <TxAvatar :src="me.avatar_url ?? undefined" :name="me.login" :size="36" />
            <div class="console-nav__me-text">
              <span class="mono console-nav__login" :title="`@${me.login}`">@{{ me.login }}</span>
              <TitleBadge :title="me.title" />
            </div>
          </div>
          <div class="console-nav__links">
            <TxButton variant="ghost" size="sm" icon="i-carbon-home" @click="openSite('portal')">官网</TxButton>
            <TxButton variant="ghost" size="sm" icon="i-carbon-forum" @click="openSite('forum')">论坛</TxButton>
            <TxButton variant="ghost" size="sm" icon="i-carbon-logout" class="console-nav__signout" @click="emit('signout')">退出</TxButton>
          </div>
        </div>
      </template>
    </TxSidebarNav>
  </div>
</template>

<style scoped>
.console-nav {
  height: 100%;
  --tx-bui-sidebar-nav-width: 100%;
}
/* TxSidebarNav 的根是一列普通块：品牌、导航、footer 依次往下排，footer 会跟在最后一项后面悬在半中间。
   改成满高的纵向 flex：导航区吃掉剩余高度并在超出时自己滚动，账号区钉在底部。 */
.console-nav :deep(.tx-bui-sidebar-nav) {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.console-nav :deep(.tx-bui-sidebar-nav__body) {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.console-nav__brand {
  margin-bottom: 8px;
  --tx-card-item-gap: 10px;
  --tx-card-item-padding: 6px;
}
.console-nav__logo {
  display: block;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  object-fit: contain;
}
.console-nav__footer {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
  padding: 12px 4px 2px;
  border-top: 1px solid var(--tx-border-color-light);
}
.console-nav__me {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.console-nav__me-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
}
.console-nav__login {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--tx-text-color-primary);
}
/* 三个按钮等宽排一行，不再按字数长短一左一右参差换行 */
.console-nav__links {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
}
.console-nav__links :deep(.tx-button) {
  justify-content: center;
  min-width: 0;
  width: 100%;
}
.console-nav__signout {
  color: var(--tx-text-color-secondary);
}
</style>
