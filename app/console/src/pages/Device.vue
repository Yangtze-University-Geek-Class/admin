<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { TxCard } from "@talex-touch/tuffex/card";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxAlert } from "@talex-touch/tuffex/alert";
import { TxInput } from "@talex-touch/tuffex/input";
import { TxAvatar } from "@talex-touch/tuffex/avatar";
import { TxSpinner } from "@talex-touch/tuffex/spinner";
import logoUrl from "../assets/logo.png";
import { ApiError, api } from "../lib/http";
import { siteUrl } from "../lib/runtime";
import {
  closedNotice, deviceSignInPath, formatUserCode, isCompleteUserCode, remainingText, scopeLines,
  type DeviceView,
} from "../lib/device";

/**
 * 设备授权确认页（#262，RFC 8628）。`geek login` 在终端里给出一串代码和本页地址，用户在这里用极客班账号登录后允许或拒绝。
 * 授权绑定到会话里的 account_id（内部 OpenID）；没登录就去 /signin，登录完带着同一串代码回来。
 */
type Me = { signed_in: boolean; login?: string; avatar_url?: string | null; account_id?: string };
type Phase = "session" | "enter" | "loading" | "review" | "approved" | "denied" | "closed";

const route = useRoute();
const router = useRouter();
const code = ref(formatUserCode(route.query.user_code));
const codeInput = computed({ get: () => code.value, set: (value: string) => { code.value = formatUserCode(value); } });
const me = ref<Me | null>(null);
const phase = ref<Phase>("session");
const view = ref<DeviceView | null>(null);
const notice = ref<{ title: string; body: string } | null>(null);
const busy = ref<"approve" | "deny" | null>(null);
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;

const NETWORK = { title: "没有连上服务器", body: "可能是网络不稳定，稍后再试一次。" };
const NOT_FOUND = { title: "没有找到这串代码", body: "核对一下终端里显示的 8 位代码；代码只在 10 分钟内有效。" };

const toSignIn = () => window.location.assign(deviceSignInPath(code.value));
const goPortal = () => window.location.assign(siteUrl("portal", "/"));
const remaining = computed(() => (view.value ? remainingText(view.value.expires_at, now.value) : ""));
const scopes = computed(() => (view.value ? scopeLines(view.value.scope) : []));

function close(status: Exclude<DeviceView["status"], "pending">) {
  notice.value = closedNotice(status);
  phase.value = "closed";
}

async function lookup() {
  if (phase.value === "loading") return;
  if (!isCompleteUserCode(code.value)) {
    notice.value = { title: "代码还没填完", body: "代码是 8 位字母，形如 BCDF-GHJK。" };
    return;
  }
  phase.value = "loading";
  notice.value = null;
  void router.replace({ query: { user_code: code.value } });
  try {
    view.value = await api<DeviceView>(`/api/identity/device?user_code=${encodeURIComponent(code.value)}`);
    if (view.value.status === "pending" && view.value.expires_at > Date.now()) phase.value = "review";
    else close(view.value.status === "pending" ? "expired" : view.value.status);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return toSignIn();
    notice.value = error instanceof ApiError && error.status === 404 ? NOT_FOUND : NETWORK;
    phase.value = "enter";
  }
}

async function decide(decision: "approve" | "deny") {
  if (busy.value) return;
  busy.value = decision;
  try {
    await api("/api/identity/device/approve", { method: "POST", body: JSON.stringify({ user_code: code.value, decision }) });
    phase.value = decision === "approve" ? "approved" : "denied";
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return toSignIn();
    if (error instanceof ApiError && (error.status === 409 || error.status === 404)) close("expired");
    else notice.value = NETWORK;
  } finally {
    busy.value = null;
  }
}

function another() {
  code.value = "";
  view.value = null;
  notice.value = null;
  phase.value = "enter";
  void router.replace({ query: {} });
}

onMounted(async () => {
  timer = setInterval(() => {
    now.value = Date.now();
    if (phase.value === "review" && view.value && view.value.expires_at <= now.value) close("expired");
  }, 1000);
  try {
    me.value = await api<Me>("/auth/me");
  } catch {
    notice.value = NETWORK;
    phase.value = "enter";
    return;
  }
  if (!me.value.signed_in) return toSignIn();
  if (isCompleteUserCode(code.value)) await lookup();
  else phase.value = "enter";
});
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <div class="device console-ground">
    <TxCard class="device__card">
      <div class="device__brand">
        <img :src="logoUrl" alt="" width="52" height="52" class="device__logo">
        <div>
          <h1>授权设备登录</h1>
          <p class="device__lead">把极客班账号连到命令行工具</p>
        </div>
      </div>

      <div v-if="phase === 'session' || phase === 'loading'" class="device__state" role="status">
        <TxSpinner :size="18" :label="phase === 'session' ? '正在确认登录状态' : '正在核对代码'" />
        <span>{{ phase === "session" ? "正在确认登录状态…" : "正在核对代码…" }}</span>
      </div>

      <div v-if="me?.signed_in && phase !== 'session'" class="device__who">
        <TxAvatar :src="me.avatar_url ?? undefined" :name="me.login" :size="32" />
        <div>
          <span class="device__who-label">当前极客班账号</span>
          <b class="mono">@{{ me.login }}</b>
        </div>
      </div>

      <TxAlert v-if="notice && phase !== 'closed'" type="warning" :title="notice.title" :closable="false" class="device__alert" data-testid="device-notice">
        {{ notice.body }}
      </TxAlert>

      <form v-if="phase === 'enter'" class="device__enter" @submit.prevent="lookup">
        <label for="device-code">终端里显示的代码</label>
        <TxInput
          id="device-code"
          v-model="codeInput"
          class="device__code-input"
          placeholder="BCDF-GHJK"
          autocomplete="one-time-code"
          spellcheck="false"
        />
        <p class="device__hint">在终端运行 <code>geek login</code> 会显示一串 8 位代码和本页地址。</p>
        <TxButton variant="primary" size="lg" icon="i-carbon-arrow-right" block :disabled="!isCompleteUserCode(code)" @click="lookup">继续</TxButton>
      </form>

      <section v-else-if="phase === 'review' && view" class="device__review" aria-labelledby="device-request">
        <div class="device__client">
          <span class="i-carbon-terminal device__client-icon" aria-hidden="true" />
          <div>
            <h2 id="device-request">{{ view.client_name }} 请求登录</h2>
            <span class="device__client-id mono">{{ view.client_id }}</span>
          </div>
        </div>
        <p class="device__code mono" aria-label="设备代码">{{ view.user_code }}</p>
        <p class="device__expire">确认这串代码和终端里的一致 · <span>{{ remaining }}</span> 后失效</p>
        <ul class="device__scopes" aria-label="允许后它可以">
          <li v-for="line in scopes" :key="line"><span class="i-carbon-checkmark" aria-hidden="true" />{{ line }}</li>
        </ul>
        <TxAlert type="warning" title="只确认自己发起的登录" :closable="false" class="device__alert">
          只有你刚在自己的电脑上运行了 geek login、并且终端里就是这串代码时才允许。别人发给你的代码不要确认。
        </TxAlert>
        <div class="device__actions">
          <TxButton variant="secondary" size="lg" icon="i-carbon-close" block :loading="busy === 'deny'" :disabled="!!busy" @click="decide('deny')">拒绝</TxButton>
          <TxButton variant="primary" size="lg" icon="i-carbon-checkmark" block :loading="busy === 'approve'" :disabled="!!busy" @click="decide('approve')">允许</TxButton>
        </div>
      </section>

      <TxAlert v-else-if="phase === 'approved'" type="success" title="已授权" :closable="false" class="device__alert" data-testid="device-result">
        回到终端，geek login 会自己完成登录。这个页面可以关掉了。
      </TxAlert>
      <TxAlert v-else-if="phase === 'denied'" type="info" title="已拒绝这次授权" :closable="false" class="device__alert" data-testid="device-result">
        终端那边会提示授权被拒绝。如果这不是你发起的，什么都不用做。
      </TxAlert>
      <TxAlert v-else-if="phase === 'closed' && notice" type="warning" :title="notice.title" :closable="false" class="device__alert" data-testid="device-result">
        {{ notice.body }}
      </TxAlert>

      <div class="device__more" :class="{ 'device__more--pair': phase === 'closed' }">
        <TxButton v-if="phase === 'closed'" variant="secondary" icon="i-carbon-edit" block @click="another">输入其它代码</TxButton>
        <TxButton variant="ghost" icon="i-carbon-arrow-left" block @click="goPortal">回到官网</TxButton>
      </div>
    </TxCard>
  </div>
</template>

<style scoped>
.device {
  display: grid;
  place-items: center;
  min-height: 100vh;
  padding: 24px 16px;
}
.device__card {
  width: min(440px, 100%);
}
.device__brand {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 6px 0 18px;
}
.device__logo {
  flex: none;
  border-radius: 14px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
}
.device h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 650;
  letter-spacing: 0.01em;
}
.device__lead {
  margin: 4px 0 0;
  color: var(--tx-text-color-secondary);
  font-size: 14px;
}
.device__state {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 0 12px;
  border-radius: 10px;
  background: var(--tx-fill-color-lighter, rgba(127, 127, 127, 0.06));
  color: var(--tx-text-color-secondary);
  font-size: 13px;
}
.device__who {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--tx-fill-color-lighter, rgba(127, 127, 127, 0.06));
}
.device__who > div {
  display: grid;
  line-height: 18px;
}
.device__who-label {
  font-size: 12px;
  color: var(--tx-text-color-secondary);
}
.device__alert {
  margin-bottom: 14px;
  text-align: left;
}
.device__enter {
  display: grid;
  gap: 10px;
}
.device__enter label {
  font-size: 13px;
  font-weight: 600;
  color: var(--tx-text-color-secondary);
}
.device__code-input :deep(input) {
  font-family: var(--tx-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 20px;
  letter-spacing: 0.18em;
  text-align: center;
  text-transform: uppercase;
}
.device__hint {
  margin: 0 0 4px;
  font-size: 12px;
  line-height: 19px;
  color: var(--tx-text-color-secondary);
}
.device__hint code {
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--tx-fill-color-light, rgba(127, 127, 127, 0.1));
}
.device__client {
  display: flex;
  align-items: center;
  gap: 12px;
}
.device__client-icon {
  flex: none;
  width: 40px;
  height: 40px;
  padding: 8px;
  border-radius: 12px;
  background: var(--tx-color-primary-light-9, rgba(64, 128, 255, 0.12));
  color: var(--tx-color-primary, #4080ff);
  box-sizing: border-box;
}
.device__client h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 620;
}
.device__client-id {
  font-size: 12px;
  color: var(--tx-text-color-secondary);
}
.device__code {
  margin: 16px 0 6px;
  padding: 12px 0;
  border: 1px dashed var(--tx-border-color, rgba(127, 127, 127, 0.35));
  border-radius: 12px;
  font-size: 28px;
  font-weight: 650;
  letter-spacing: 0.22em;
  text-align: center;
}
.device__expire {
  margin: 0 0 12px;
  font-size: 12px;
  text-align: center;
  color: var(--tx-text-color-secondary);
}
.device__expire span {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.device__scopes {
  display: grid;
  gap: 6px;
  margin: 0 0 14px;
  padding: 0;
  list-style: none;
  font-size: 13px;
}
.device__scopes li {
  display: flex;
  align-items: center;
  gap: 8px;
}
.device__scopes span {
  color: var(--tx-color-success, #00b42a);
}
.device__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.device__more {
  display: grid;
  gap: 10px;
  margin-top: 12px;
}
.device__more--pair {
  grid-template-columns: 1fr 1fr;
}
.mono {
  font-family: var(--tx-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
}
@media (max-width: 440px) {
  .device__more--pair {
    grid-template-columns: 1fr;
  }
}
</style>
