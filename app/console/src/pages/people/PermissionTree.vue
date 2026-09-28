<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { TxSearchInput } from "@talex-touch/tuffex/search-input";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxTag } from "@talex-touch/tuffex/tag";
import { TxAlert } from "@talex-touch/tuffex/alert";
import { TxEmptyState } from "@talex-touch/tuffex/empty-state";
import { TxSelect } from "@talex-touch/tuffex/select";
import { TxFilterChips } from "@talex-touch/tuffex/filter-chips";
import ErrorPanel from "../../components/ErrorPanel.vue";
import LoadingBlock from "../../components/LoadingBlock.vue";
import { api } from "../../lib/http";
import { useResource, type Resource } from "../../lib/resource";
import { useSession } from "../../lib/session";
import { buildPermissionTree, configuredPerspectiveDetails, permissionDomainLabel, type PermissionDetail } from "../../lib/permission-tree";
import { permissionBoundary } from "../../lib/permission-boundaries";
import type { Capability, Catalogue, Department, TitleId } from "../../lib/types";

const props = defineProps<{ departments: Resource<{ departments: Department[] }> }>();
const { me, meError, meLoading, reload: reloadMe } = useSession();

const snapshot = useResource(async () => {
  const [catalogue] = await Promise.all([api<Catalogue>("/api/console/catalogue"), reloadMe()]);
  if (meError.value) throw meError.value;
  if (!me.value) throw new Error("没有取得当前登录身份，请重新登录。");
  return { catalogue };
});
const loading = computed(() => snapshot.loading.value || props.departments.loading.value || meLoading.value);
const error = computed(() => meError.value || snapshot.error.value || props.departments.error.value);
const model = computed(() => {
  if (loading.value || error.value || !snapshot.data.value || !props.departments.data.value || !me.value) return null;
  return buildPermissionTree(snapshot.data.value.catalogue, props.departments.data.value.departments, me.value);
});
async function refresh() {
  if (loading.value) return;
  await Promise.all([snapshot.reload(), props.departments.reload()]);
}

// 视角切换：完全由后端接口动态生成（当前我的权限 / 称号权限包 / 部门权限包）
const selectedPerspective = ref<string>("me");

const perspectiveOptions = computed(() => {
  const options: { value: string; label: string }[] = [];
  if (!snapshot.data.value?.catalogue || !props.departments.data.value?.departments) return options;

  const myTitleNames = me.value?.titles.map(t => t.label).join(" · ") || "当前成员";
  options.push({ value: "me", label: `我 · ${myTitleNames}` });

  // 动态读取 /api/console/catalogue 中的称号定义
  for (const t of snapshot.data.value.catalogue.titles) {
    options.push({ value: `title:${t.id}`, label: `称号 · ${t.label}` });
  }

  // 动态读取 /api/console/departments 中的部门定义
  const headLabel = snapshot.data.value.catalogue.titles.find(title => title.id === "head")?.label ?? "负责人";
  const memberLabel = snapshot.data.value.catalogue.titles.find(title => title.id === "member")?.label ?? "成员";
  for (const d of props.departments.data.value.departments) {
    if (d.archived) continue;
    options.push({ value: `dept:${d.id}:head`, label: `部门 · ${d.name} / ${headLabel}` });
    options.push({ value: `dept:${d.id}:member`, label: `部门 · ${d.name} / ${memberLabel}` });
  }

  return options;
});
watch(perspectiveOptions, options => {
  if (options.length && !options.some(option => option.value === selectedPerspective.value)) selectedPerspective.value = "me";
});

// 当前视角信息
const currentPerspectiveInfo = computed(() => {
  const p = selectedPerspective.value;
  const cat = snapshot.data.value?.catalogue;
  const depts = props.departments.data.value?.departments ?? [];

  if (p === "me" || !cat) {
    return {
      type: "me" as const,
      title: `@${me.value?.login ?? ""}`,
      sub: me.value?.titles.map(t => t.label).join(" · ") || "当前成员",
      isOwner: me.value?.github_role === "admin",
    };
  }

  if (p.startsWith("title:")) {
    const titleId = p.slice(6) as TitleId;
    const t = cat.titles.find(item => item.id === titleId);
    return {
      type: "title" as const,
      title: `称号 · ${t?.label ?? titleId}`,
      sub: "称号基础权限",
      isOwner: titleId === "admin",
    };
  }

  if (p.startsWith("dept:")) {
    const [, deptId, role] = p.split(":");
    const d = depts.find(item => item.id === deptId);
    const roleLabel = cat.titles.find(item => item.id === (role === "head" ? "head" : "member"))?.label ?? "成员";
    return {
      type: "dept" as const,
      title: `部门 · ${d?.name ?? deptId}`,
      sub: `${roleLabel}的部门权限`,
      isOwner: false,
    };
  }

  return { type: "me" as const, title: "", sub: "", isOwner: false };
});

// 状态筛选
const statusFilter = ref<"all" | "effective" | "blocked" | "ungranted">("all");
const query = ref("");
watch(selectedPerspective, () => { statusFilter.value = "all"; query.value = ""; });

// 业务域分类
const DOMAIN_ICONS: Record<string, string> = {
  console: "i-carbon-dashboard", applications: "i-carbon-user-follow", forum: "i-carbon-forum",
  github: "i-carbon-logo-github", roles: "i-carbon-badge", feedback: "i-carbon-chat",
  audit: "i-carbon-security",
};

// 选中的能力 ID
const selectedId = ref<string>("");

// 当前视角下的全部能力列表（由后端接口动态派生）
const currentPerspectiveItems = computed<PermissionDetail[]>(() => {
  const p = selectedPerspective.value;
  const cat = snapshot.data.value?.catalogue;
  const depts = props.departments.data.value?.departments ?? [];
  if (!cat || !model.value) return [];

  if (p === "me") {
    // 真实登录身份视角
    return [...model.value.details.values()];
  }

  // 动态称号或部门视角：直接从后端配置推导
  let directList: Capability[] = [];
  if (p.startsWith("title:")) {
    const titleId = p.slice(6) as TitleId;
    directList = titleId === "admin" ? cat.capabilities.map(c => c.id) : (cat.role_base[titleId] ?? []);
  } else if (p.startsWith("dept:")) {
    const [, deptId, role] = p.split(":");
    const d = depts.find(item => item.id === deptId);
    directList = d ? (role === "head" ? d.head_capabilities : d.member_capabilities) : [];
  }

  return configuredPerspectiveDetails(cat, directList, p, currentPerspectiveInfo.value.title);
});

// 统计
const counts = computed(() => {
  const res = { effective: 0, blocked: 0, ungranted: 0, total: 0 };
  for (const item of currentPerspectiveItems.value) {
    res.total++;
    res[item.status]++;
  }
  return res;
});
const effectiveLabel = computed(() => selectedPerspective.value === "me" ? "已生效" : "已包含");
const filters = computed(() => [
  { value: "all", label: "全部", count: counts.value.total },
  ...(counts.value.effective > 0 && counts.value.effective < counts.value.total ? [{ value: "effective", label: effectiveLabel.value, count: counts.value.effective }] : []),
  ...(counts.value.blocked > 0 && counts.value.blocked < counts.value.total ? [{ value: "blocked", label: "受限", count: counts.value.blocked }] : []),
  ...(counts.value.ungranted > 0 && counts.value.ungranted < counts.value.total ? [{ value: "ungranted", label: "未包含", count: counts.value.ungranted }] : []),
]);
watch(filters, options => {
  if (!options.some(option => option.value === statusFilter.value)) statusFilter.value = "all";
});
function setFilter(value: unknown) {
  if (value === "all" || value === "effective" || value === "blocked" || value === "ungranted") statusFilter.value = value;
}

// 按业务域分组的能力列表
const groupedCapabilities = computed(() => {
  const map = new Map<string, PermissionDetail[]>();
  const q = query.value.trim().toLowerCase();

  for (const item of currentPerspectiveItems.value) {
    // 状态过滤
    if (statusFilter.value === "effective" && item.status !== "effective") continue;
    if (statusFilter.value === "blocked" && item.status !== "blocked") continue;
    if (statusFilter.value === "ungranted" && item.status !== "ungranted") continue;

    // 搜索过滤
    if (q) {
      const match = item.id.toLowerCase().includes(q) ||
        item.label.toLowerCase().includes(q) ||
        (item.description && item.description.toLowerCase().includes(q));
      if (!match) continue;
    }
    const domain = item.domain || "other";
    if (!map.has(domain)) map.set(domain, []);
    map.get(domain)!.push(item);
  }

  const result: { domain: string; label: string; icon: string; items: PermissionDetail[] }[] = [];
  for (const [domain, items] of map.entries()) {
    const label = permissionDomainLabel(snapshot.data.value!.catalogue, domain);
    result.push({ domain, label, icon: DOMAIN_ICONS[domain] ?? "i-carbon-folder", items });
  }
  return result;
});

// 平铺所有当前展示的能力
const visibleItems = computed(() => groupedCapabilities.value.flatMap(g => g.items));

// 当前选中的详情
const currentDetail = computed(() => {
  if (!selectedId.value) return undefined;
  return currentPerspectiveItems.value.find(item => item.id === selectedId.value);
});
const currentBoundary = computed(() => currentDetail.value ? permissionBoundary(currentDetail.value.id) : null);

// 来源归属提取
const titleGrants = computed(() => {
  if (!currentDetail.value) return [];
  return currentDetail.value.grants.filter(g => g.active && g.sourceKey.startsWith("title:"));
});
const departmentGrants = computed(() => {
  if (!currentDetail.value) return [];
  return currentDetail.value.grants.filter(g => g.active && (g.sourceKey.startsWith("department:") || g.sourceKey.startsWith("dept:")));
});
const automaticGrants = computed(() => {
  if (!currentDetail.value) return [];
  return currentDetail.value.grants.filter(g => g.active && g.sourceKey.startsWith("automatic:"));
});

// 默认选中第一项
watch(visibleItems, list => {
  if (!list.length) {
    selectedId.value = "";
    return;
  }
  if (!selectedId.value || !list.some(item => item.id === selectedId.value)) {
    selectedId.value = list[0].id;
  }
}, { immediate: true });

const searchInput = ref<InstanceType<typeof TxSearchInput> | null>(null);
const listRegion = ref<HTMLElement | null>(null);
const detailsRegion = ref<HTMLElement | null>(null);
let disposed = false;

async function jumpToDetails() {
  await nextTick();
  if (disposed) return;
  detailsRegion.value?.focus();
  detailsRegion.value?.scrollIntoView({ block: "start" });
}

function selectCapability(id: string) {
  selectedId.value = id;
  if (window.matchMedia("(max-width: 900px)").matches) void jumpToDetails();
}
function backToList() {
  const button = [...(listRegion.value?.querySelectorAll<HTMLButtonElement>("[data-capability-id]") ?? [])]
    .find(item => item.dataset.capabilityId === selectedId.value);
  button?.focus();
  button?.scrollIntoView({ block: "nearest" });
}

const capabilityLabel = (id: string) => {
  const cat = snapshot.data.value?.catalogue;
  return cat?.capabilities.find(c => c.id === id)?.label ?? id;
};

function onShortcut(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  const editing = target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest("input, textarea, select, [role='textbox']")));
  if (event.key === "/" && !editing && model.value) {
    event.preventDefault();
    searchInput.value?.focus();
  } else if (event.key === "Escape" && query.value) {
    event.preventDefault();
    query.value = "";
    searchInput.value?.focus();
  }
}
onMounted(() => document.addEventListener("keydown", onShortcut));
onBeforeUnmount(() => {
  disposed = true;
  document.removeEventListener("keydown", onShortcut);
});
</script>

<template>
  <div class="permission-tree" :aria-busy="loading">
    <LoadingBlock v-if="loading" label="正在读取权限目录与身份配置" :lines="6" />
    <ErrorPanel v-else-if="error" :error="error" :retry="refresh" />
    <template v-else-if="model && me && snapshot.data.value">
      <header class="permission-tree__profile-header">
        <div class="permission-tree__user-card">
          <div class="permission-tree__user-main">
            <strong class="permission-tree__username" :class="{ mono: currentPerspectiveInfo.type === 'me' }">{{ currentPerspectiveInfo.title }}</strong>
            <span class="permission-tree__role-badge">{{ currentPerspectiveInfo.sub }}</span>
          </div>
          <div class="permission-tree__stat-line">
            <span class="stat-item stat-item--success">
              {{ counts.effective }} 项{{ selectedPerspective === 'me' ? '生效' : '包含' }}
            </span>
            <span v-if="counts.blocked" class="stat-item stat-item--warning">
              {{ counts.blocked }} 项受限
            </span>
            <span v-if="counts.ungranted" class="stat-item stat-item--muted">
              {{ counts.ungranted }} 项未包含
            </span>
            <span class="stat-total">共 {{ counts.total }} 项</span>
          </div>
        </div>

        <div class="permission-tree__actions-bar">
          <div class="permission-tree__persona-picker">
            <span class="permission-tree__picker-label">查看对象</span>
            <TxSelect
              v-model="selectedPerspective"
              :options="perspectiveOptions"
              class="permission-tree__persona-select"
              aria-label="切换查看视角"
            />
          </div>
          <TxButton variant="bare" size="sm" icon="i-carbon-renew" :loading="loading" :disabled="loading" @click="refresh">刷新数据</TxButton>
        </div>
      </header>

      <TxAlert v-if="model.warnings.length" type="warning" title="部分权限来源存在不一致" :closable="false" class="permission-tree__alert">
        <ul class="permission-tree__warnings"><li v-for="warning in model.warnings" :key="warning">{{ warning }}</li></ul>
      </TxAlert>

      <div class="permission-tree__workspace">
        <section ref="listRegion" class="permission-tree__list-pane" aria-label="能力列表">
          <div class="permission-tree__filter-bar">
            <TxFilterChips v-if="filters.length > 1" :model-value="statusFilter" :items="filters" aria-label="按权限状态筛选" @update:model-value="setFilter" />
            <div class="permission-tree__search-wrap">
              <TxSearchInput ref="searchInput" v-model="query" placeholder="搜索能力" aria-label="搜索能力名称或代码" />
            </div>
          </div>

          <div class="permission-tree__groups-scroll">
            <div v-for="group in groupedCapabilities" :key="group.domain" class="permission-tree__domain-group">
              <div class="permission-tree__domain-header">
                <span :class="group.icon" class="permission-tree__domain-icon" />
                <span class="permission-tree__domain-title">{{ group.label }}</span>
                <span class="permission-tree__domain-count">{{ group.items.length }}</span>
              </div>

              <div class="permission-tree__domain-items">
                <button
                  v-for="item in group.items"
                  :key="item.id"
                  type="button"
                  class="permission-tree__item-row"
                  :class="{
                    'permission-tree__item-row--active': selectedId === item.id,
                    'permission-tree__item-row--blocked': item.status === 'blocked',
                  }"
                  :aria-current="selectedId === item.id ? 'true' : undefined"
                  aria-controls="permission-detail-panel"
                  :data-capability-id="item.id"
                  @click="selectCapability(item.id)"
                >
                  <div class="permission-tree__item-main">
                    <span class="permission-tree__item-name">{{ item.label }}</span>
                    <code class="permission-tree__item-code mono">{{ item.id }}</code>
                  </div>
                  <div class="permission-tree__item-tags">
                    <TxTag
                      v-if="item.status === 'effective'"
                      :label="selectedPerspective === 'me' ? '生效' : '包含'"
                      color="var(--tx-color-success)"
                      variant="soft"
                      size="sm"
                    />
                    <TxTag
                      v-else-if="item.status === 'blocked'"
                      label="受限"
                      color="var(--tx-color-warning)"
                      variant="soft"
                      size="sm"
                    />
                    <TxTag
                      v-else
                      label="未包含"
                      variant="plain"
                      size="sm"
                    />
                  </div>
                </button>
              </div>
            </div>

            <TxEmptyState
              v-if="!groupedCapabilities.length"
              :title="query ? '没有找到匹配的权限' : '当前暂无权限'"
              :description="query ? '请尝试输入其他关键词' : '当前筛选条件下没有条目'"
              size="small"
            >
              <template #actions>
                <TxButton v-if="query" size="sm" @click="query = ''">清空搜索</TxButton>
              </template>
            </TxEmptyState>
          </div>
        </section>

        <section id="permission-detail-panel" ref="detailsRegion" class="permission-tree__detail-pane" tabindex="-1" aria-label="权限详情">
          <div v-if="currentDetail && currentBoundary" class="permission-detail">
            <TxButton variant="bare" size="sm" icon="i-carbon-arrow-left" class="permission-detail__back" @click="backToList">返回权限列表</TxButton>
            <!-- 头部 -->
            <header class="permission-detail__head">
              <div class="permission-detail__head-top">
                <h3 class="permission-detail__name">{{ currentDetail.label }}</h3>
                <div class="permission-detail__status-pills">
                  <TxTag
                    v-if="currentDetail.status === 'effective'"
                    :label="effectiveLabel"
                    color="var(--tx-color-success)"
                    variant="soft"
                  />
                  <TxTag
                    v-else-if="currentDetail.status === 'blocked'"
                    label="受 GitHub 限制"
                    color="var(--tx-color-warning)"
                    variant="soft"
                  />
                  <TxTag
                    v-else
                    label="当前视角未包含"
                    variant="plain"
                  />
                  <TxTag v-if="currentBoundary.reserved" label="尚未开放" variant="plain" />
                </div>
              </div>
              <code class="permission-detail__id-pill mono">{{ currentDetail.id }}</code>
              <p class="permission-detail__desc">{{ currentDetail.description || '当前能力暂无详细说明。' }}</p>
            </header>

            <!-- 受 GitHub 限制警示 -->
            <div v-if="currentDetail.reason" class="permission-detail__alert-box permission-detail__alert-box--warning">
              <span class="i-carbon-warning-alt-filled permission-detail__alert-icon" />
              <div>
                <strong>受 GitHub 身份限制</strong>
                <p>
                  {{ currentDetail.reason === 'github_admin_required' ? '此操作需要 GitHub 组织所有者身份。当前账号无法执行。' : '此操作需要 GitHub 组织成员身份。' }}
                </p>
              </div>
            </div>

            <!-- 权限来源归属 -->
            <div class="permission-detail__card">
              <h4 class="permission-detail__card-title">
                <span class="i-carbon-badge" /> 来源
              </h4>

              <!-- 提督全局规则 -->
              <div v-if="currentPerspectiveInfo.isOwner" class="permission-detail__source-row">
                <span class="permission-detail__source-tag">组织所有者</span>
                <div class="permission-detail__source-desc">
                  <strong>全部权限</strong>
                  <p>由 GitHub 组织身份自动获得。</p>
                </div>
              </div>

              <!-- 称号赋予 -->
              <div v-else-if="titleGrants.length" class="permission-detail__source-row">
                <span class="permission-detail__source-tag permission-detail__source-tag--title">称号</span>
                <div class="permission-detail__source-desc">
                  <strong>{{ titleGrants.map(g => g.label).join('、') }}</strong>
                  <p v-for="g in titleGrants" :key="g.sourceKey">
                    <span v-if="g.kind === 'implied'">包含于 <code>{{ g.via.map(capabilityLabel).join('、') }}</code></span>
                    <span v-else>直接授予</span>
                  </p>
                </div>
              </div>

              <!-- 部门赋予 -->
              <div v-if="departmentGrants.length" class="permission-detail__source-row">
                <span class="permission-detail__source-tag permission-detail__source-tag--dept">部门</span>
                <div class="permission-detail__source-desc">
                  <strong>{{ departmentGrants.map(g => g.label).join('、') }}</strong>
                  <p v-for="g in departmentGrants" :key="g.sourceKey">
                    <span v-if="g.kind === 'implied'">包含于 <code>{{ g.via.map(capabilityLabel).join('、') }}</code></span>
                    <span v-else>直接授予</span>
                  </p>
                </div>
              </div>

              <!-- 自动入口 -->
              <div v-if="automaticGrants.length && !titleGrants.length && !departmentGrants.length && !currentPerspectiveInfo.isOwner" class="permission-detail__source-row">
                <span class="permission-detail__source-tag">系统自动</span>
                <div class="permission-detail__source-desc">
                  <strong>控制台访问</strong>
                  <p>由已有业务权限自动获得。</p>
                </div>
              </div>

              <!-- 未授予 -->
              <p v-if="currentDetail.status === 'ungranted'" class="permission-detail__unassigned-note">
                当前查看对象没有这项权限。
              </p>
            </div>

            <!-- 业务范围与执行点 -->
            <div class="permission-detail__card">
              <h4 class="permission-detail__card-title">
                <span class="i-carbon-security" /> 使用范围
              </h4>
              <div class="permission-detail__field-grid">
                <div class="permission-detail__field">
                  <span class="permission-detail__field-name">适用范围</span>
                  <p class="permission-detail__field-val">{{ currentBoundary.scope }}</p>
                </div>
                <div class="permission-detail__field">
                  <span class="permission-detail__field-name">执行接口</span>
                  <p class="permission-detail__field-val mono">{{ currentBoundary.execution }}</p>
                </div>
                <div v-if="currentBoundary.pages.length" class="permission-detail__field">
                  <span class="permission-detail__field-name">关联功能页面</span>
                  <div class="permission-detail__links">
                    <RouterLink v-for="p in currentBoundary.pages" :key="p.path" :to="p.path" class="permission-detail__page-btn">
                      <span class="i-carbon-launch" />
                      {{ p.label }}
                    </RouterLink>
                  </div>
                </div>
              </div>
            </div>

            <!-- 包含的下层能力 -->
            <div v-if="currentDetail.implies.length || currentDetail.impliedBy.length" class="permission-detail__card">
              <h4 class="permission-detail__card-title">
                <span class="i-carbon-flow" /> 关联能力
              </h4>
              <div v-if="currentDetail.implies.length" class="permission-detail__relation-row">
                <span class="permission-detail__relation-label">同时包含</span>
                <div class="permission-detail__relation-pills">
                  <button v-for="id in currentDetail.implies" :key="id" type="button" class="permission-detail__pill-chip" @click="selectCapability(id)">
                    <span>{{ capabilityLabel(id) }}</span>
                    <code class="mono">{{ id }}</code>
                  </button>
                </div>
              </div>
              <div v-if="currentDetail.impliedBy.length" class="permission-detail__relation-row">
                <span class="permission-detail__relation-label">属于以下能力</span>
                <div class="permission-detail__relation-pills">
                  <button v-for="id in currentDetail.impliedBy" :key="id" type="button" class="permission-detail__pill-chip" @click="selectCapability(id)">
                    <span>{{ capabilityLabel(id) }}</span>
                    <code class="mono">{{ id }}</code>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <TxEmptyState
            v-else
            title="请选择一项权限"
            description="从能力列表中选择一项查看详情。"
            size="small"
            class="permission-detail__empty"
          />
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.permission-tree {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
}

.permission-tree__profile-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px 24px;
  padding: 22px 24px;
  background: var(--tx-fill-color-blank);
  border-bottom: 1px solid var(--tx-border-color-lighter);
}
.permission-tree__user-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.permission-tree__user-main {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}
.permission-tree__username {
  font-size: 1.125rem;
  font-weight: 650;
  color: var(--tx-text-color-primary);
}
.permission-tree__role-badge {
  font-size: .8125rem;
  color: var(--tx-text-color-secondary);
}
.permission-tree__stat-line {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 16px;
  font-size: .8125rem;
}
.stat-item {
  display: inline-flex;
  align-items: center;
}
.stat-item--success {
  color: var(--tx-color-success);
}
.stat-item--warning {
  color: var(--tx-color-warning);
}
.stat-item--muted {
  color: var(--tx-text-color-secondary);
}
.stat-total {
  color: var(--tx-text-color-secondary);
  font-size: .8125rem;
}

.permission-tree__actions-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.permission-tree__persona-picker {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: .8125rem;
}
.permission-tree__picker-label {
  color: var(--tx-text-color-secondary);
  white-space: nowrap;
}
.permission-tree__persona-select {
  min-width: 260px;
  max-width: min(360px, 50vw);
}

.permission-tree__workspace {
  display: grid;
  grid-template-columns: minmax(280px, 34%) minmax(0, 1fr);
  align-items: start;
}

.permission-tree__list-pane {
  background: var(--tx-fill-color-blank);
  border-right: 1px solid var(--tx-border-color-lighter);
  padding: 20px 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.permission-tree__filter-bar {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.permission-tree__groups-scroll {
  max-height: 720px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.permission-tree__domain-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.permission-tree__domain-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px 8px;
  font-size: .8125rem;
  font-weight: 600;
  color: var(--tx-text-color-secondary);
  border-bottom: 1px solid var(--tx-border-color-lighter);
  margin-bottom: 2px;
}
.permission-tree__domain-icon {
  font-size: .875rem;
}
.permission-tree__domain-title {
  flex: 1;
}
.permission-tree__domain-count {
  font-size: .75rem;
  color: var(--tx-text-color-secondary);
}
.permission-tree__domain-items {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.permission-tree__item-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 9px;
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: all .12s ease;
}
.permission-tree__item-row:hover {
  background: var(--tx-fill-color-light);
}
.permission-tree__item-row--active {
  background: color-mix(in srgb, var(--tx-color-primary) 10%, transparent);
  color: var(--tx-color-primary);
}
.permission-tree__item-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.permission-tree__item-name {
  font-size: .8125rem;
  font-weight: 500;
  color: var(--tx-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.permission-tree__item-code {
  font-size: .6875rem;
  color: var(--tx-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 右侧详情面板 */
.permission-tree__detail-pane {
  background: var(--tx-fill-color-blank);
  padding: 24px 28px 32px;
  min-width: 0;
}
.permission-detail {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.permission-detail__back { display: none; }
.permission-detail__head {
  border-bottom: 1px solid var(--tx-border-color-lighter);
  padding-bottom: 22px;
}
.permission-detail__head-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.permission-detail__name {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 650;
  color: var(--tx-text-color-primary);
}
.permission-detail__status-pills {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.permission-detail__id-pill {
  display: inline-block;
  margin-top: 4px;
  padding: 2px 6px;
  font-size: .75rem;
  background: var(--tx-fill-color-light);
  color: var(--tx-text-color-secondary);
  border-radius: 4px;
}
.permission-detail__desc {
  margin: 10px 0 0;
  font-size: .875rem;
  line-height: 1.6;
  color: var(--tx-text-color-regular);
}

/* 警示框 */
.permission-detail__alert-box {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 6px;
  font-size: .8125rem;
  line-height: 1.5;
}
.permission-detail__alert-box--warning {
  background: color-mix(in srgb, var(--tx-color-warning) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--tx-color-warning) 30%, transparent);
  color: var(--tx-text-color-primary);
}
.permission-detail__alert-icon {
  font-size: 1rem;
  color: var(--tx-color-warning);
  flex-shrink: 0;
  margin-top: 2px;
}
.permission-detail__alert-box strong {
  display: block;
  margin-bottom: 2px;
}
.permission-detail__alert-box p {
  margin: 0;
}

/* 详情卡片 */
.permission-detail__card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px 0;
  border-bottom: 1px solid var(--tx-border-color-lighter);
}
.permission-detail__card-title {
  margin: 0;
  font-size: .875rem;
  font-weight: 600;
  color: var(--tx-text-color-primary);
  display: flex;
  align-items: center;
  gap: 6px;
}
.permission-detail__source-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 0;
}
.permission-detail__source-tag {
  font-size: .6875rem;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--tx-fill-color-light);
  color: var(--tx-text-color-secondary);
  flex-shrink: 0;
}
.permission-detail__source-tag--title {
  background: color-mix(in srgb, var(--tx-color-primary) 12%, transparent);
  color: var(--tx-color-primary);
  font-weight: 500;
}
.permission-detail__source-tag--dept {
  background: color-mix(in srgb, var(--tx-color-success) 12%, transparent);
  color: var(--tx-color-success);
  font-weight: 500;
}
.permission-detail__source-desc strong {
  font-size: .8125rem;
  color: var(--tx-text-color-primary);
  display: block;
}
.permission-detail__source-desc p {
  margin: 2px 0 0;
  font-size: .75rem;
  color: var(--tx-text-color-secondary);
}
.permission-detail__unassigned-note {
  margin: 0;
  font-size: .8125rem;
  color: var(--tx-text-color-secondary);
}

/* 范围字段网格 */
.permission-detail__field-grid {
  display: grid;
  gap: 10px;
}
.permission-detail__field {
  display: grid;
  gap: 3px;
}
.permission-detail__field-name {
  font-size: .75rem;
  font-weight: 500;
  color: var(--tx-text-color-secondary);
}
.permission-detail__field-val {
  margin: 0;
  font-size: .8125rem;
  line-height: 1.5;
  color: var(--tx-text-color-primary);
}
.permission-detail__links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 2px;
}
.permission-detail__page-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  font-size: .75rem;
  color: var(--tx-color-primary);
  background: var(--tx-fill-color-blank);
  border: 1px solid var(--tx-border-color-lighter);
  border-radius: 4px;
  text-decoration: none;
}
.permission-detail__page-btn:hover {
  border-color: var(--tx-color-primary);
}

/* 包含关系 */
.permission-detail__relation-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.permission-detail__relation-label {
  font-size: .75rem;
  color: var(--tx-text-color-secondary);
}
.permission-detail__relation-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.permission-detail__pill-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  font-size: .75rem;
  background: var(--tx-fill-color-blank);
  border: 1px solid var(--tx-border-color-lighter);
  border-radius: 4px;
  color: var(--tx-text-color-primary);
  cursor: pointer;
  transition: all .12s ease;
}
.permission-detail__pill-chip:hover {
  border-color: var(--tx-color-primary);
  color: var(--tx-color-primary);
}
.permission-detail__pill-chip code {
  color: var(--tx-text-color-secondary);
  font-size: .6875rem;
}
.permission-detail__empty {
  padding: 48px 0;
}

@media (max-width: 900px) {
  .permission-tree__profile-header {
    flex-direction: column;
    align-items: stretch;
  }
  .permission-tree__actions-bar {
    flex-wrap: wrap;
  }
  .permission-tree__workspace {
    grid-template-columns: minmax(0, 1fr);
  }
  .permission-tree__list-pane {
    border-right: 0;
    border-bottom: 1px solid var(--tx-border-color-lighter);
  }
  .permission-tree__persona-select {
    min-width: 0;
    max-width: min(100%, 360px);
  }
  .permission-tree__detail-pane {
    padding: 22px 20px;
  }
  .permission-detail__back {
    display: inline-flex;
    align-self: flex-start;
    margin-bottom: 14px;
  }
}
</style>
