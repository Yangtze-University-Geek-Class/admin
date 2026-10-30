<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { TxCard } from "@talex-touch/tuffex/card";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxRadio, TxRadioGroup } from "@talex-touch/tuffex/radio";
import { TxDataTable } from "@talex-touch/tuffex/data-table";
import { TxEmptyState } from "@talex-touch/tuffex/empty-state";
import { TxStatusBadge } from "@talex-touch/tuffex/status-badge";
import PageHeader from "../components/PageHeader.vue";
import ErrorPanel from "../components/ErrorPanel.vue";
import ErrorAlert from "../components/ErrorAlert.vue";
import LoadingBlock from "../components/LoadingBlock.vue";
import { api } from "../lib/http";
import { fmtDate } from "../lib/format";
import { confirm, settleConfirm, type ConfirmOptions } from "../lib/confirm";
import { useAction, useResource } from "../lib/resource";
import { useSession } from "../lib/session";
import type { ActivityList, SecurityBlock, SecurityBlocks, SecurityDecoyStatus } from "../lib/types";

const { can } = useSession();
const settings = useResource(() => api<SecurityDecoyStatus>("/api/console/security/decoy"));
const blocks = useResource(() => api<SecurityBlocks>("/api/console/security/blocks"));
const records = useResource(() => api<ActivityList>("/api/console/activity?action=security.decoy.hit"), [], { enabled: () => can("activity.read") });
const duration = ref(30);
const tick = ref(performance.now());
let receivedAt = tick.value;
let disposed = false;
let confirming = false;
watch(settings.data, () => { receivedAt = performance.now(); tick.value = receivedAt; }, { flush: "sync" });
// 只用服务器时间加单调时钟的已逝时长，浏览器时区或本机时钟偏差不会延长有效期。
const now = computed(() => (settings.data.value?.now ?? 0) + Math.max(0, tick.value - receivedAt));
const remaining = computed(() => Math.max(0, Math.ceil(((settings.data.value?.expires_at ?? 0) - now.value) / 1000)));
const active = computed(() => Boolean(settings.data.value?.active && remaining.value > 0));
const hits = computed(() => records.data.value?.items.slice(0, 10) ?? []);
const timer = window.setInterval(() => { tick.value = performance.now(); }, 1000);
onScopeDispose(() => {
  disposed = true;
  window.clearInterval(timer);
  if (confirming) settleConfirm(false);
});
async function ask(options: ConfirmOptions) {
  confirming = true;
  const accepted = await confirm(options);
  confirming = false;
  return accepted && !disposed;
}
const change = useAction(async (enabled: boolean) => {
  const minutes = duration.value;
  if (!await ask({
    title: enabled ? "开启合成蜜罐？" : "关闭合成蜜罐？",
    body: enabled
      ? `开启 ${minutes} 分钟，之后自动到期。首次符合条件的探测只收到合成诊断数据和授权告知，来源仍被封禁。不会开放管理权限或业务数据。`
      : "停止返回合成诊断数据，基础防护和已有封禁保持不变。",
    confirmText: enabled ? "确认开启" : "确认关闭",
  })) return;
  const status = await api<SecurityDecoyStatus>("/api/console/security/decoy", {
    method: "PUT", body: JSON.stringify(enabled ? { enabled: true, duration_minutes: minutes } : { enabled: false }),
  });
  if (disposed) return;
  settings.data.value = status;
  await settings.reload();
});
const unblock = useAction(async (ip: string) => {
  if (!await ask({ title: "解除封禁？", body: `来源：${ip}\n解除后可以重新访问；再次触发防护仍会被封禁。请先核对是否为误封。`, confirmText: "确认解封", danger: true })) return;
  await api(`/api/console/security/blocks/${encodeURIComponent(ip)}`, { method: "DELETE" });
  if (!disposed) await blocks.reload();
});
const busy = computed(() => change.pending.value || unblock.pending.value);
function refresh() {
  if (busy.value) return;
  void settings.reload();
  void blocks.reload();
  void records.reload();
}
watch(active, (value, previous) => { if (!value && previous && !busy.value) void settings.reload(); });
const blockColumns = [
  { key: "ip", title: "来源 IP", minWidth: 180 }, { key: "reason", title: "原因", minWidth: 120 },
  { key: "until", title: "封禁截止", width: 180 }, { key: "actions", title: "操作", width: 100 },
];
const hitColumns = [
  { key: "at", title: "时间", width: 180 }, { key: "target_id", title: "探针族", minWidth: 140 },
  { key: "ip", title: "来源 IP", minWidth: 180 },
];
</script>

<template>
  <div class="page">
    <PageHeader title="安全防护" description="管理临时合成蜜罐，核对封禁与探测记录。">
      <template #actions><TxButton variant="secondary" icon="i-carbon-renew" :disabled="busy || settings.loading.value || blocks.loading.value || records.loading.value" @click="refresh">刷新</TxButton></template>
    </PageHeader>
    <ErrorAlert v-if="change.error.value" :error="change.error.value" @close="change.reset" />
    <ErrorPanel v-if="settings.error.value" :error="settings.error.value" :retry="settings.reload" />
    <LoadingBlock v-else-if="!settings.data.value" :lines="3" />
    <TxCard v-else>
      <div class="section-heading">
        <h2>合成蜜罐</h2>
        <TxStatusBadge :status="active ? 'warning' : 'info'" :text="active ? '已开启' : settings.data.value.expires_at && remaining === 0 ? '已到期' : '已关闭'" />
      </div>
      <p>基础防护：{{ settings.data.value.shield_enabled ? '已开启' : '已关闭' }}。合成蜜罐仅在正式环境可开启，单次最多 {{ settings.data.value.max_minutes }} 分钟。</p>
      <p v-if="!settings.data.value.available">当前不是正式环境，不能开启合成蜜罐。</p>
      <p v-else-if="!settings.data.value.shield_enabled">先开启基础防护，才能使用合成蜜罐。</p>
      <p>只返回有界的合成诊断信息与 AI 授权告知，不返回真实凭据、管理权限或业务数据。告知不能保证阻止 AI 抓取或分析；鉴权、限流和封禁始终保留。</p>
      <p v-if="settings.data.value.expires_at">截止时间：{{ fmtDate(settings.data.value.expires_at) }}<span v-if="active"> · 剩余 {{ Math.floor(remaining / 60) }} 分 {{ remaining % 60 }} 秒</span></p>
      <TxRadioGroup v-model="duration" aria-label="开启时长" :disabled="busy || active || !settings.data.value.available || !settings.data.value.shield_enabled">
        <TxRadio :value="15">15 分钟</TxRadio><TxRadio :value="30">30 分钟</TxRadio><TxRadio :value="60">60 分钟</TxRadio>
      </TxRadioGroup>
      <div class="actions">
        <TxButton :disabled="busy || settings.loading.value || active || !settings.data.value.available || !settings.data.value.shield_enabled" @click="change.execute(true)">开启合成蜜罐</TxButton>
        <TxButton variant="secondary" :disabled="busy || settings.loading.value || settings.data.value.expires_at === null" @click="change.execute(false)">关闭合成蜜罐</TxButton>
        <RouterLink v-if="can('activity.read')" to="/console/activity?action=security.">查看防护操作记录</RouterLink>
      </div>
    </TxCard>

    <TxCard :padding="0">
      <div class="section-heading padded"><h2>当前封禁</h2></div>
      <ErrorAlert v-if="unblock.error.value" :error="unblock.error.value" @close="unblock.reset" />
      <ErrorPanel v-if="blocks.error.value" :error="blocks.error.value" :retry="blocks.reload" />
      <LoadingBlock v-else-if="!blocks.data.value" :lines="3" />
      <template v-else>
        <TxDataTable class="table-wide" :columns="blockColumns" :data="blocks.data.value.blocks" row-key="ip" table-layout="fixed">
          <template #cell-ip="{ row }: { row: SecurityBlock }"><span class="mono wrap">{{ row.ip }}</span></template>
          <template #cell-until="{ row }: { row: SecurityBlock }">{{ fmtDate(row.blocked_until) }}</template>
          <template #cell-actions="{ row }: { row: SecurityBlock }"><TxButton size="sm" variant="danger" :disabled="busy || blocks.loading.value" @click="unblock.execute(row.ip)">解封</TxButton></template>
          <template #empty><TxEmptyState title="当前没有封禁" description="触发防护的来源会出现在这里，可刷新核对。" size="small" /></template>
        </TxDataTable>
        <ul class="row-cards">
          <li v-for="row in blocks.data.value.blocks" :key="row.ip">
            <div class="row-card__head"><span class="mono wrap">{{ row.ip }}</span><TxButton size="sm" variant="danger" :disabled="busy || blocks.loading.value" @click="unblock.execute(row.ip)">解封</TxButton></div>
            <div class="row-card__lines"><span>{{ row.reason }} · 第 {{ row.level }} 级</span><span>截止：{{ fmtDate(row.blocked_until) }}</span></div>
          </li>
          <li v-if="!blocks.data.value.blocks.length"><TxEmptyState title="当前没有封禁" description="触发防护的来源会出现在这里，可刷新核对。" size="small" /></li>
        </ul>
      </template>
    </TxCard>

    <TxCard v-if="can('activity.read')" :padding="0">
      <div class="section-heading padded"><h2>最近蜜罐命中</h2><RouterLink to="/console/activity?action=security.decoy.hit">查看全部</RouterLink></div>
      <ErrorPanel v-if="records.error.value" :error="records.error.value" :retry="records.reload" />
      <LoadingBlock v-else-if="!records.data.value" :lines="3" />
      <template v-else>
        <TxDataTable class="table-wide" :columns="hitColumns" :data="hits" row-key="id" table-layout="fixed">
          <template #cell-at="{ row }: { row: ActivityList['items'][number] }">{{ fmtDate(row.at) }}</template>
          <template #empty><TxEmptyState title="还没有蜜罐命中" description="开启后符合条件的探测会留下记录；没有命中不代表没有攻击。" size="small" /></template>
        </TxDataTable>
        <ul class="row-cards">
          <li v-for="row in hits" :key="row.id"><div class="row-card__head">{{ fmtDate(row.at) }}</div><div class="row-card__lines"><span>{{ row.target_id }}</span><span class="mono wrap">{{ row.ip }}</span></div></li>
          <li v-if="!hits.length"><TxEmptyState title="还没有蜜罐命中" description="开启后符合条件的探测会留下记录；没有命中不代表没有攻击。" size="small" /></li>
        </ul>
      </template>
    </TxCard>
  </div>
</template>

<style scoped>
h2 { margin: 0; font-size: 1rem; font-weight: 600; }
p { color: var(--tx-text-color-secondary); line-height: 1.7; }
.section-heading, .actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.section-heading { justify-content: space-between; }
.padded { padding: 16px; }
.actions { margin-top: 16px; }
.wrap { overflow-wrap: anywhere; min-width: 0; }
</style>
