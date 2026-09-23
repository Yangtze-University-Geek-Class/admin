<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { TxCard } from "@talex-touch/tuffex/card";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxAlert } from "@talex-touch/tuffex/alert";
import logoUrl from "../assets/logo.png";
import { isMock, signInHref, siteUrl } from "../lib/runtime";

/** 未登录：只有一个 GitHub 登录按钮。登录后回到原来要去的控制台页面。 */
const route = useRoute();
const returnPath = computed(() => {
  const raw = typeof route.query.return_to === "string" ? route.query.return_to : "";
  return raw.startsWith("/console") || raw.startsWith("/admin") ? raw : "/console";
});
const href = computed(() => signInHref(`${window.location.origin}${returnPath.value}`));
const signedOut = computed(() => route.query.signed_out === "1");
const portal = siteUrl("portal", "/");
const signIn = () => window.location.assign(href.value);
</script>

<template>
  <div class="signin console-ground">
    <TxCard class="signin__card">
      <img :src="logoUrl" alt="" width="56" height="56" class="signin__logo">
      <h1>极客班控制台</h1>
      <p>用你的 GitHub 账号登录。能看到哪些页面、能做哪些操作，取决于你在极客班的称号。</p>
      <TxAlert v-if="signedOut" type="success" title="你已退出登录" :closable="false" class="signin__alert" />
      <TxAlert v-if="isMock()" type="info" title="开发预览" :closable="false" class="signin__alert">
        当前是样板数据，登录按钮会连到本地后端。要看登录后的页面，去掉地址里的 __persona=signed_out。
      </TxAlert>
      <TxButton variant="primary" size="lg" icon="i-carbon-logo-github" block @click="signIn">用 GitHub 登录</TxButton>
      <a :href="portal" class="signin__back">回到官网</a>
    </TxCard>
  </div>
</template>

<style scoped>
.signin {
  display: grid;
  place-items: center;
  min-height: 100vh;
  padding: 24px 16px;
}
.signin__card {
  width: min(420px, 100%);
  text-align: center;
}
.signin__logo {
  display: block;
  margin: 12px auto 16px;
  border-radius: 14px;
}
.signin h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
}
.signin p {
  margin: 8px 0 20px;
  line-height: 22px;
  color: var(--tx-text-color-secondary);
}
.signin__alert {
  margin-bottom: 16px;
  text-align: left;
}
.signin__back {
  display: inline-block;
  margin: 16px 0 8px;
  font-size: 13px;
}
</style>
