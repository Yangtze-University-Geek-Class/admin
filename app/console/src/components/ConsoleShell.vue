<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import { TxDrawer } from "@talex-touch/tuffex/drawer";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxAlert } from "@talex-touch/tuffex/alert";
import ConsoleNav from "./ConsoleNav.vue";
import CapabilityGate from "./CapabilityGate.vue";
import TitleBadge from "./TitleBadge.vue";
import logoUrl from "../assets/logo.png";
import { api } from "../lib/http";
import { isMock } from "../lib/runtime";
import { clearSession } from "../lib/session";
import type { ConsoleMe } from "../lib/types";

/** 登录后的外壳：桌面左侧导航，≤900px 顶栏 + 抽屉导航。 */
const props = defineProps<{ me: ConsoleMe }>();
const route = useRoute();
const router = useRouter();
const drawerOpen = ref(false);
const roleText = computed(() => props.me.github_role === "admin" ? "组织管理员" : props.me.github_role === "member" ? "组织成员" : "未加入组织");

watch(() => route.fullPath, () => { drawerOpen.value = false; });

async function signOut() {
  drawerOpen.value = false;
  try { await api("/auth/signout", { method: "POST" }); } catch { /* 会话已失效时也要回到登录页 */ }
  clearSession();
  void router.replace({ path: "/signin", query: { signed_out: "1" } });
}
</script>

<template>
  <div class="shell">
    <aside class="shell__sidebar">
      <ConsoleNav :me="me" @signout="signOut" />
    </aside>

    <header class="shell__topbar">
      <TxButton variant="ghost" icon="i-carbon-menu" aria-label="打开导航" @click="drawerOpen = true">菜单</TxButton>
      <span class="shell__topbar-brand">
        <img :src="logoUrl" alt="" width="24" height="24">
        极客班控制台
      </span>
      <TitleBadge :title="me.title" />
    </header>

    <TxDrawer v-model:visible="drawerOpen" title="导航" direction="left" size="min(320px, 86vw)" :mobile-adapt="false" :show-footer="false">
      <ConsoleNav :me="me" @navigate="drawerOpen = false" @signout="signOut" />
    </TxDrawer>

    <main class="shell__main console-ground">
      <div class="shell__context">
        <span class="mono">{{ me.org }}</span>
        <span class="shell__role">{{ roleText }}</span>
        <span v-if="isMock()" class="shell__mock">开发预览 · 样板数据</span>
      </div>
      <div v-if="me.bootstrap" class="shell__notice">
        <TxAlert type="warning" title="还没有正式舰长" :closable="false">
          现在由 GitHub 组织管理员临时代任舰长。请在「成员与权限」里用「添加称号」指定正式舰长。
        </TxAlert>
      </div>
      <RouterView v-slot="{ Component, route: current }">
        <CapabilityGate :key="current.path" :any-of="(current.meta.anyOf as string[] | undefined) ?? ['console.access']">
          <component :is="Component" />
        </CapabilityGate>
      </RouterView>
    </main>
  </div>
</template>

<style scoped>
.shell {
  display: grid;
  grid-template-columns: var(--console-sidebar-width) minmax(0, 1fr);
  min-height: 100vh;
}
.shell__sidebar {
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
  padding: 12px 0 12px 12px;
}
.shell__topbar {
  display: none;
}
.shell__main {
  min-width: 0;
  min-height: 100vh;
}
.shell__context {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 6px 14px;
  max-width: 1360px;
  margin: 0 auto;
  padding: 14px 32px 0;
  font-size: 12px;
  color: var(--tx-text-color-secondary);
}
.shell__mock {
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px dashed var(--tx-border-color);
}
.shell__notice {
  max-width: 1360px;
  margin: 12px auto 0;
  padding: 0 32px;
}

@media (max-width: 900px) {
  .shell {
    grid-template-columns: minmax(0, 1fr);
  }
  .shell__sidebar {
    display: none;
  }
  .shell__topbar {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 52px;
    padding: 6px 12px;
    background: var(--tx-bg-color);
    border-bottom: 1px solid var(--tx-border-color-light);
  }
  .shell__topbar-brand {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .shell__topbar-brand img {
    border-radius: 6px;
  }
  .shell__context {
    justify-content: flex-start;
    padding: 12px 16px 0;
  }
  .shell__notice {
    padding: 0 16px;
  }
}
</style>
