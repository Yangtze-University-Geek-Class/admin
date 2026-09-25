<script setup lang="ts">
import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { TxCard } from "@talex-touch/tuffex/card";
import { TxSpinner } from "@talex-touch/tuffex/spinner";
import { TxButton } from "@talex-touch/tuffex/button";
import ConsoleShell from "../components/ConsoleShell.vue";
import ErrorPanel from "../components/ErrorPanel.vue";
import TitleBadge from "../components/TitleBadge.vue";
import logoUrl from "../assets/logo.png";
import { ApiError } from "../lib/http";
import { loadMe, useSession } from "../lib/session";
import { siteUrl } from "../lib/runtime";

/** /console 下所有页面的入口：先取身份，未登录去 /signin，没有任何能力显示访客说明。 */
const { me, meError, meLoading, reload } = useSession();
const route = useRoute();
const router = useRouter();

void loadMe();

const signedOut = computed(() => meError.value instanceof ApiError && meError.value.status === 401);
watch(signedOut, value => {
  if (!value) return;
  // 登录没成功回到这里时（?signin=<原因>），原因交给登录页说明，不跟着塞进 return_to
  const { signin, ...query } = route.query;
  const returnTo = router.resolve({ path: route.path, query, hash: route.hash }).fullPath;
  void router.replace({ path: "/signin", query: { return_to: returnTo, ...(typeof signin === "string" && { signin }) } });
}, { immediate: true });

const guest = computed(() => me.value && me.value.capabilities.length === 0);
const goPortal = () => window.location.assign(siteUrl("portal", "/"));
const openOrg = () => window.open(`https://github.com/${me.value?.org ?? ""}`, "_blank", "noopener");
</script>

<template>
  <div v-if="(meLoading && !me) || signedOut" class="root-state" role="status">
    <TxSpinner :size="24" label="正在确认登录状态" />
    <span class="muted">正在确认登录状态</span>
  </div>

  <div v-else-if="meError && !me" class="root-state console-ground">
    <div class="root-state__box">
      <ErrorPanel :error="meError" :retry="reload" size="large" />
    </div>
  </div>

  <div v-else-if="guest && me" class="root-state console-ground">
    <TxCard class="guest">
      <img :src="logoUrl" alt="" width="48" height="48" class="guest__logo">
      <h1>你还不能使用控制台</h1>
      <p>
        你用 GitHub 账号 <span class="mono">@{{ me.login }}</span> 登录了，但还没有加入
        <span class="mono">{{ me.org }}</span>，也没有被指派称号。
      </p>
      <p>加入 GitHub 组织后刷新本页；或者请班长在「成员与权限」里给你指派称号。</p>
      <div class="guest__badge"><TitleBadge :title="me.title" /></div>
      <div class="guest__actions">
        <TxButton variant="secondary" @click="goPortal">回到官网</TxButton>
        <TxButton variant="primary" icon="i-carbon-logo-github" @click="openOrg">打开 GitHub 组织</TxButton>
      </div>
    </TxCard>
  </div>

  <ConsoleShell v-else-if="me" :me="me" />
</template>

<style scoped>
.root-state {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 12px;
  min-height: 100vh;
  padding: 24px 16px;
}
.root-state__box {
  width: min(520px, 100%);
}
.guest {
  width: min(520px, 100%);
  text-align: center;
}
.guest__logo {
  display: block;
  margin: 8px auto 12px;
  border-radius: 12px;
}
.guest h1 {
  margin: 0 0 8px;
  font-size: 20px;
  font-weight: 600;
}
.guest p {
  margin: 6px 0;
  line-height: 22px;
  color: var(--tx-text-color-regular);
}
.guest__badge {
  margin: 14px 0 4px;
}
.guest__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin: 16px 0 8px;
}
</style>
