<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { TxCard } from "@talex-touch/tuffex/card";
import { TxDataTable } from "@talex-touch/tuffex/data-table";
import { TxInput } from "@talex-touch/tuffex/input";
import { TxSelect } from "@talex-touch/tuffex/select";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxAvatar } from "@talex-touch/tuffex/avatar";
import { TxTag } from "@talex-touch/tuffex/tag";
import { TxCellLink } from "@talex-touch/tuffex/cell-link";
import { TxStatusBadge } from "@talex-touch/tuffex/status-badge";
import { TxTooltip } from "@talex-touch/tuffex/tooltip";
import { TxEmptyState } from "@talex-touch/tuffex/empty-state";
import { TxPagination } from "@talex-touch/tuffex/pagination";
import { TxDrawer } from "@talex-touch/tuffex/drawer";
import { toast } from "@talex-touch/tuffex/utils";
import PageHeader from "../components/PageHeader.vue";
import AccountPicker from "../components/AccountPicker.vue";
import ErrorPanel from "../components/ErrorPanel.vue";
import LoadingBlock from "../components/LoadingBlock.vue";
import { api } from "../lib/http";
import { fmtDate, fmtRelative } from "../lib/format";
import { isMock } from "../lib/runtime";
import { useResource } from "../lib/resource";
import { useSession } from "../lib/session";
import {
  ACTIVITY_OUTCOMES, ACTIVITY_PAGE_SIZE, ACTIVITY_SURFACES, OUTCOME_STATUS, OUTCOME_TEXT, SURFACE_TEXT, TIME_PRESETS, actionFamily, actionText,
  activityParams, actorText, bucketText, eventSubText, extraFilterTags, filtersFromQuery, filtersToQuery, outcomeText, presetOf, presetRange,
  surfaceText, targetText, type ActivityFilters, type TimePreset,
} from "../lib/activity";
import type { ActivityEvent, ActivityList } from "../lib/types";

const route = useRoute();
const router = useRouter();
const { can } = useSession();

// 筛选只留一行四样（#370）：谁、来源、时间范围、结果。访客、动作和自定义日期只从详情或别的页面带进来，显示成可关掉的标签。
const filters = computed(() => filtersFromQuery(route.query));
const page = computed(() => Math.max(1, Math.floor(Number(route.query.page)) || 1));
const draft = reactive({ account: filters.value.account });
watch(filters, value => { draft.account = value.account; });

/** 改了筛选条件就回到第一页。 */
function apply(next: Partial<ActivityFilters>) {
  void router.replace({ query: filtersToQuery({ ...filters.value, ...next }) });
}
const clearAll = () => void router.replace({ query: {} });
const filtered = computed(() => Object.values(filters.value).some(Boolean));

const logCard = ref<{ $el?: HTMLElement } | null>(null);
function goPage(value: number) {
  void router.replace({ query: { ...filtersToQuery(filters.value), ...(value > 1 ? { page: String(value) } : {}) } });
  logCard.value?.$el?.scrollIntoView({ block: "start", behavior: "smooth" });
}

const list = useResource(() => api<ActivityList>(`/api/console/activity?${activityParams(filters.value, { page: page.value })}`), [filters, page]);
const rows = computed(() => list.data.value?.items ?? []);
const total = computed(() => list.data.value?.total ?? 0);

const blocked = computed(() => [...(list.data.value?.blocked_today ?? [])].sort((a, b) => b.count - a.count));
const blockedTotal = computed(() => blocked.value.reduce((sum, item) => sum + item.count, 0));

// TxSelect 的「全部」用 all 占位，写回地址栏时换成空
const ALL = "all";
const pick = (value: unknown) => (value === ALL ? "" : String(value ?? ""));
const surfaceOptions = [{ value: ALL, label: "全部来源" }, ...ACTIVITY_SURFACES.map(id => ({ value: id, label: SURFACE_TEXT[id] }))];
const outcomeOptions = [{ value: ALL, label: "全部结果" }, ...ACTIVITY_OUTCOMES.map(id => ({ value: id, label: OUTCOME_TEXT[id] }))];
const timePreset = computed(() => presetOf(filters.value));
// 地址栏带的是自定义日期时，下拉显示「自定义日期」，具体日期在下面的标签里
const timeOptions = computed(() => [
  ...TIME_PRESETS.map(item => ({ value: item.value || ALL, label: item.label })),
  ...(timePreset.value === null ? [{ value: "custom", label: "自定义日期", disabled: true }] : []),
]);
const blockedHint = computed(() => blocked.value.map(item => `${bucketText(item.bucket) || item.bucket} ${item.count}`).join("，"));
const tags = computed(() => extraFilterTags(filters.value));

/** 地址栏只带了账号编号：从读到的记录里找这个人的名字给选择框。 */
const accountText = computed(() => {
  const hit = rows.value.find(row => row.account?.id === filters.value.account)?.account;
  return hit ? `${hit.display_name || hit.username} @${hit.username}` : "";
});

const columns = [
  { key: "at", title: "时间", width: 148 },
  { key: "who", title: "谁", width: 190 },
  // key 不能叫 action：Tuffex 把叫 action(s) 的列当操作列，钉在表格右边，窄屏会盖住别的列
  { key: "event", title: "做了什么", align: "left" as const },
  { key: "surface", title: "来源", width: 84 },
  { key: "outcome", title: "结果", width: 88 },
];
const rowClass = (row: ActivityEvent) => (row.outcome === "ok" ? "" : "row--problem");
const exportHref = computed(() => `/api/console/activity.csv?${activityParams(filters.value)}`);

const open = ref<ActivityEvent | null>(null);
const drawerOpen = computed({ get: () => open.value !== null, set: value => { if (!value) open.value = null; } });
const metaText = (event: ActivityEvent) => JSON.stringify(event.meta ?? {}, null, 2);
const gitlabLink = (event: ActivityEvent) => (event.surface === "gitlab" && typeof event.meta?.url === "string" ? event.meta.url : "");
function narrow(next: Partial<ActivityFilters>) {
  apply(next);
  open.value = null;
}
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast({ title: "已复制", variant: "success" });
  } catch {
    toast({ title: "没能复制，请手动选中", variant: "warning" });
  }
}
</script>

<template>
  <div class="page">
    <PageHeader title="操作记录" description="谁在官网、论坛、控制台、命令行和 GitLab 上做了什么。记录保留 180 天，IP 保留 90 天。">
      <template v-if="can('activity.export')" #actions>
        <TxTooltip v-if="isMock()" content="开发预览不能导出，请连接本地后端">
          <TxButton icon="i-carbon-download" disabled>导出 CSV</TxButton>
        </TxTooltip>
        <a v-else :href="exportHref" download class="export-link">
          <TxButton icon="i-carbon-download" tabindex="-1">导出 CSV</TxButton>
        </a>
      </template>
    </PageHeader>

    <TxCard ref="logCard" :padding="0" class="log">
      <div class="toolbar">
        <div class="toolbar__who">
          <AccountPicker v-if="can('users.view')" :model-value="filters.account" :initial-text="accountText" label="谁" placeholder="谁：用户名或昵称" @update:model-value="value => apply({ account: value })" />
          <TxInput v-else v-model="draft.account" class="fill-width mono" placeholder="账号编号" spellcheck="false" autocomplete="off" @keydown.enter.prevent="apply({ account: draft.account.trim() })" @blur="apply({ account: draft.account.trim() })" />
        </div>
        <TxSelect :model-value="filters.surface || ALL" :options="surfaceOptions" class="toolbar__select" aria-label="来源" :searchable="false" panel-background="pure" @update:model-value="(value: unknown) => apply({ surface: pick(value) })" />
        <TxSelect :model-value="timePreset === null ? 'custom' : timePreset || ALL" :options="timeOptions" class="toolbar__select" aria-label="时间" :searchable="false" panel-background="pure" @update:model-value="(value: unknown) => apply(presetRange(pick(value) as TimePreset))" />
        <TxSelect :model-value="filters.outcome || ALL" :options="outcomeOptions" class="toolbar__select" aria-label="结果" :searchable="false" panel-background="pure" @update:model-value="(value: unknown) => apply({ outcome: pick(value) })" />
        <span class="toolbar__end">
          <TxTooltip v-if="blockedTotal && filters.outcome !== 'limited'" :content="`按限流规则：${blockedHint}`">
            <TxButton size="sm" variant="ghost" @click="apply({ outcome: 'limited', ...presetRange('today') })">今天被拦下 {{ blockedTotal }} 次</TxButton>
          </TxTooltip>
          <span v-if="list.data.value" class="total">共 {{ total.toLocaleString("zh-CN") }} 条</span>
          <TxButton v-if="filtered" size="sm" variant="ghost" @click="clearAll">清空</TxButton>
        </span>
      </div>
      <div v-if="tags.length" class="tags">
        <TxTag v-for="tag in tags" :key="tag.key" :label="tag.text" size="sm" variant="soft" closable :close-aria-label="`去掉 ${tag.text}`" @close="apply(tag.clear)" />
      </div>

      <ErrorPanel v-if="list.error.value" :error="list.error.value" :retry="list.reload" class="log__state" />
      <LoadingBlock v-else-if="!list.data.value" :lines="8" class="log__state" />
      <template v-else>
        <TxDataTable
          style="--table-min: 760px"
          :columns="columns"
          :data="rows"
          row-key="id"
          table-layout="fixed"
          scroll-x
          :row-class="rowClass"
          :loading="list.loading.value"
          @row-click="({ row }: { row: ActivityEvent }) => (open = row)"
        >
          <template #cell-at="{ row }: { row: ActivityEvent }">
            <span class="mono nowrap" :title="fmtRelative(row.at)">{{ fmtDate(row.at) }}</span>
          </template>
          <template #cell-who="{ row }: { row: ActivityEvent }">
            <span class="who">
              <TxAvatar v-if="row.account" :src="row.account.avatar_url ?? undefined" :name="actorText(row).text" :size="22" />
              <TxCellLink
                v-if="row.account"
                :href="`/console/activity?account=${encodeURIComponent(row.account.id)}`"
                :label="actorText(row).text"
                :title="`@${row.account.username}`"
                :aria-label="`只看 ${actorText(row).text} 的记录`"
                class="ellipsis"
                @open="apply({ account: row.account.id })"
              />
              <span v-else class="muted ellipsis" :class="{ mono: row.visitor_id }" :title="actorText(row).text">{{ actorText(row).text }}</span>
            </span>
          </template>
          <template #cell-event="{ row }: { row: ActivityEvent }">
            <span class="event ellipsis" :title="row.action">
              <span v-if="actionText(row.action)">{{ actionText(row.action) }}</span>
              <span v-else class="mono">{{ row.action }}</span>
              <span v-if="eventSubText(row)" class="event__sub mono">{{ eventSubText(row) }}</span>
            </span>
          </template>
          <template #cell-surface="{ row }: { row: ActivityEvent }">
            <span class="muted">{{ surfaceText(row.surface) }}</span>
          </template>
          <template #cell-outcome="{ row }: { row: ActivityEvent }">
            <span v-if="row.outcome === 'ok'" class="muted">成功</span>
            <TxStatusBadge v-else :text="outcomeText(row.outcome)" :status="OUTCOME_STATUS[row.outcome] ?? 'muted'" size="sm" />
          </template>
          <template #empty>
            <TxEmptyState
              :variant="filtered ? 'search-empty' : 'no-data'"
              :title="filtered ? '没有符合条件的记录' : '还没有记录'"
              :description="filtered ? '换一个筛选条件，或者点「清空」看全部。' : '有人登录、发帖、在控制台或 GitLab 里操作后会记在这里。'"
              size="small"
            />
          </template>
        </TxDataTable>
        <div v-if="total > ACTIVITY_PAGE_SIZE" class="pager">
          <TxPagination
            :current-page="page"
            :page-size="ACTIVITY_PAGE_SIZE"
            :total="total"
            show-info
            aria-label="翻页"
            prev-label="上一页"
            next-label="下一页"
            first-label="第一页"
            last-label="最后一页"
            @update:current-page="goPage"
          >
            <template #info="{ currentPage, totalPages }">第 {{ currentPage }} / {{ totalPages }} 页，每页 {{ ACTIVITY_PAGE_SIZE }} 条</template>
          </TxPagination>
        </div>
      </template>
    </TxCard>

    <TxDrawer v-model:visible="drawerOpen" title="记录详情" direction="right" size="min(520px, 100vw)" :mobile-adapt="false" :show-footer="false">
      <div v-if="open" class="detail">
        <dl class="facts">
          <dt>时间</dt><dd>{{ fmtDate(open.at) }}</dd>
          <dt>谁</dt>
          <dd>
            <template v-if="open.account">{{ actorText(open).text }} <span class="mono muted">@{{ open.account.username }}</span></template>
            <template v-else>{{ actorText(open).text }}</template>
          </dd>
          <template v-if="open.visitor_id"><dt>访客编号</dt><dd class="mono">{{ open.visitor_id }}</dd></template>
          <dt>来源</dt><dd>{{ surfaceText(open.surface) }}</dd>
          <dt>动作</dt><dd class="action"><span v-if="actionText(open.action)">{{ actionText(open.action) }}</span><span class="mono muted">{{ open.action }}</span></dd>
          <dt>目标</dt><dd class="mono">{{ targetText(open) || "-" }}</dd>
          <dt>结果</dt><dd><TxStatusBadge :text="outcomeText(open.outcome)" :status="OUTCOME_STATUS[open.outcome] ?? 'muted'" size="sm" /></dd>
          <dt>IP</dt><dd class="mono">{{ open.ip ?? "-" }}</dd>
          <dt>浏览器</dt><dd class="ua">{{ open.ua ?? "-" }}</dd>
          <template v-if="open.request_id">
            <dt>请求编号</dt>
            <dd class="request">
              <span class="mono">{{ open.request_id }}</span>
              <TxButton size="sm" variant="ghost" icon="i-carbon-copy" :aria-label="`复制请求编号 ${open.request_id}`" @click="copy(open.request_id)" />
            </dd>
          </template>
        </dl>
        <section v-if="Object.keys(open.meta ?? {}).length" class="meta">
          <h3 class="section-title">附加信息</h3>
          <pre class="pre">{{ metaText(open) }}</pre>
        </section>
        <div class="detail__links">
          <TxButton v-if="open.account" variant="secondary" @click="narrow({ account: open.account.id })">只看这个人</TxButton>
          <TxButton v-if="open.visitor_id" variant="secondary" @click="narrow({ visitor: open.visitor_id })">只看这个访客</TxButton>
          <TxButton variant="secondary" @click="narrow({ action: actionFamily(open.action) })">只看同类动作</TxButton>
          <RouterLink v-if="open.account && can('users.view')" :to="{ path: '/console/users', query: { q: open.account.username } }" class="more-link">打开用户详情</RouterLink>
          <a v-if="gitlabLink(open)" :href="gitlabLink(open)" target="_blank" rel="noopener noreferrer" class="more-link">在 GitLab 里打开</a>
        </div>
      </div>
    </TxDrawer>
  </div>
</template>

<style scoped>
.export-link {
  text-decoration: none;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  padding: 12px 16px;
}
.toolbar__who {
  flex: 0 1 240px;
  min-width: 200px;
}
.toolbar__select {
  width: 116px;
}
.toolbar__end {
  display: inline-flex;
  align-items: center;
  gap: 4px 10px;
  margin-left: auto;
}
.total {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: var(--tx-text-color-secondary);
}
.tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  padding: 0 16px 12px;
}
.log__state {
  margin: 0 16px 16px;
}
.log :deep(.tx-data-table) {
  border-top: 1px solid var(--tx-border-color-lighter);
}
.log :deep(tbody tr) {
  cursor: pointer;
}
/* 被拒绝、被限流、出错的行底色稍深一点，一眼能扫到 */
.log :deep(tbody tr.row--problem) {
  background: color-mix(in srgb, var(--tx-color-warning) 6%, transparent);
}
.who {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.nowrap {
  white-space: nowrap;
}
.event {
  display: block;
}
.event__sub {
  margin-left: 10px;
  font-size: 12px;
  color: var(--tx-text-color-secondary);
}
.pager {
  display: flex;
  justify-content: flex-end;
  padding: 12px 16px;
  border-top: 1px solid var(--tx-border-color-lighter);
}
.detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.action {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 8px;
}
.ua {
  font-size: 13px;
  color: var(--tx-text-color-secondary);
}
.request {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.meta {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* GitLab 事件的 meta 带完整链接，折行显示，不在抽屉边上截断 */
.meta .pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.detail__links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
}
.detail__links :deep(button) {
  min-height: 44px;
  min-width: 44px;
}
.more-link {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  font-size: 14px;
}
@media (max-width: 640px) {
  .toolbar__who {
    flex-basis: 100%;
  }
  .toolbar__select {
    flex: 1 1 96px;
    width: auto;
  }
  .toolbar__end {
    margin-left: 0;
  }
}
</style>
