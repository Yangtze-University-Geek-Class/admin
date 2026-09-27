<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { TxTree, type TreeKey, type TreeNode } from "@talex-touch/tuffex/tree";
import { TxSearchInput } from "@talex-touch/tuffex/search-input";
import { TxTabs, TxTabItem } from "@talex-touch/tuffex/tabs";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxTag } from "@talex-touch/tuffex/tag";
import { TxAlert } from "@talex-touch/tuffex/alert";
import { TxEmptyState } from "@talex-touch/tuffex/empty-state";
import ErrorPanel from "../../components/ErrorPanel.vue";
import LoadingBlock from "../../components/LoadingBlock.vue";
import { api } from "../../lib/http";
import { carbon } from "../../lib/icons";
import { fmtDate } from "../../lib/format";
import { useResource, type Resource } from "../../lib/resource";
import { useSession } from "../../lib/session";
import { buildPermissionTree, type PermissionNode, type PermissionDetail, type PermissionSource } from "../../lib/permission-tree";
import { permissionBoundary } from "../../lib/permission-boundaries";
import type { Catalogue, Department } from "../../lib/types";

const props = defineProps<{ departments: Resource<{ departments: Department[] }> }>();
const { me, meError, meLoading, reload: reloadMe } = useSession();
// Unlike the shared display catalogue, this read must retain the exact API error and never use defaults.
const snapshot = useResource(async () => {
  const [catalogue] = await Promise.all([api<Catalogue>("/api/console/catalogue"), reloadMe()]);
  if (meError.value) throw meError.value;
  if (!me.value) throw new Error("没有取得当前登录身份，请重新登录。");
  return { catalogue, readAt: Date.now() };
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

const views = ["按能力域", "按称号/部门来源"];
const view = ref(views[0]);
const query = ref("");
const searching = computed(() => Boolean(query.value.trim()));
const expanded = ref<Record<string, TreeKey[]>>({ [views[0]]: [], [views[1]]: [] });
const initialized = new Set<string>();
const selection = ref<Record<string, string>>({ [views[0]]: "", [views[1]]: "" });
const nodes = computed(() => (view.value === views[0] ? model.value?.byDomain : model.value?.bySource) ?? []);
const nodeIndex = computed(() => {
  const result = new Map<string, PermissionNode>();
  function visit(list: PermissionNode[]) {
    for (const node of list) {
      result.set(node.key, node);
      if (node.children) visit(node.children);
    }
  }
  visit(nodes.value);
  return result;
});
const sourceIndex = computed(() => new Map(model.value?.sources.map(source => [source.key, source]) ?? []));
const selected = computed(() => nodeIndex.value.get(selection.value[view.value]));
const detail = computed(() => selected.value?.capability ? model.value?.details.get(selected.value.capability) : undefined);
const source = computed(() => selected.value?.sourceKey ? sourceIndex.value.get(selected.value.sourceKey) : undefined);
const boundary = computed(() => detail.value ? permissionBoundary(detail.value.id) : null);
const counts = computed(() => {
  const result = { effective: 0, blocked: 0, ungranted: 0 };
  for (const detail of model.value?.details.values() ?? []) result[detail.status]++;
  return result;
});
const currentGrants = computed(() => detail.value?.grants.filter(grant => grant.active) ?? []);
const configuredGrants = computed(() => detail.value?.grants.filter(grant => !grant.active) ?? []);
const capabilityLabel = (id: string) => model.value?.details.get(id)?.label ?? id;
const statusText = (detail?: PermissionDetail) => detail ? { effective: "已生效", blocked: "受 GitHub 限制", ungranted: "未授予" }[detail.status] : "";
const statusColor = (detail?: PermissionDetail) => detail?.status === "effective" ? "var(--tx-color-success)" : detail?.status === "blocked" ? "var(--tx-color-warning)" : "var(--tx-text-color-secondary)";
const sourceText = (source: PermissionSource) => source.archived ? "已归档 · 不参与" : source.active ? "当前来源" : "配置来源 · 非当前";
const grantText = (kind: string) => kind === "direct" ? "直接授予" : kind === "implied" ? "隐含授予" : "自动授予";
const nodeInfo = (node: TreeNode) => nodeIndex.value.get(String(node.key));
const nodeDetail = (node: TreeNode) => model.value?.details.get(nodeInfo(node)?.capability ?? "");
const nodeSource = (node: TreeNode) => sourceIndex.value.get(nodeInfo(node)?.sourceKey ?? "");
const filterNode = (node: TreeNode, text: string) => (nodeInfo(node)?.searchText ?? node.label).toLowerCase().includes(text.toLowerCase());
function rememberExpansion(keys: TreeKey[]) {
  // TxTree temporarily expands matching ancestors; query interactions must not overwrite the saved view.
  if (!searching.value) expanded.value[view.value] = keys;
}
function expandAll() {
  expanded.value[view.value] = [...nodeIndex.value.values()].filter(node => node.children?.length).map(node => node.key);
}
watch(nodes, list => {
  if (!list.length) return;
  if (!initialized.has(view.value)) {
    expanded.value[view.value] = list.map(node => node.key);
    initialized.add(view.value);
  }
  if (selection.value[view.value] && !nodeIndex.value.has(selection.value[view.value])) selection.value[view.value] = "";
});

const searchInput = ref<InstanceType<typeof TxSearchInput> | null>(null);
const treeRegion = ref<HTMLElement | null>(null);
const detailsRegion = ref<HTMLElement | null>(null);
let disposed = false;
async function jumpToDetails() {
  await nextTick();
  if (disposed) return;
  detailsRegion.value?.focus();
  detailsRegion.value?.scrollIntoView({ block: "start" });
}
function selectNode(payload: { key: TreeKey }) {
  selection.value[view.value] = String(payload.key);
  if (window.matchMedia("(max-width: 900px)").matches) void jumpToDetails();
}
function backToTree() {
  const target = treeRegion.value?.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]') ?? treeRegion.value;
  target?.focus();
  target?.scrollIntoView({ block: "nearest" });
}
async function inspectCapability(id: string) {
  view.value = views[0];
  query.value = "";
  await nextTick();
  const node = [...nodeIndex.value.values()].find(item => item.capability === id);
  if (!node || disposed) return;
  selection.value[view.value] = node.key;
  // Keep the selected capability visible when returning to the tree.
  expanded.value[view.value] = [...new Set([...expanded.value[view.value], ...nodes.value.filter(root => root.children?.some(child => child.key === node.key)).map(root => root.key)])];
  await jumpToDetails();
}
function onShortcut(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  const editing = target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest("input, textarea, select, [role='textbox']")));
  if (event.key === "/" && !editing && model.value) {
    event.preventDefault();
    searchInput.value?.focus();
  } else if (event.key === "Escape" && query.value && (!editing || (target instanceof Node && treeRegion.value?.contains(target)))) {
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
  <section class="permission-tree" aria-label="我的权限树" :aria-busy="loading">
    <header class="permission-tree__header">
      <div>
        <h2>我的权限树</h2>
        <p>查看当前登录账号的能力与配置来源，只读，不在这里授予或撤销权限。</p>
      </div>
      <TxButton icon="i-carbon-renew" :loading="loading" :disabled="loading" @click="refresh">刷新权限</TxButton>
    </header>

    <LoadingBlock v-if="loading" label="正在读取权限目录、部门配置与我的身份" :lines="7" />
    <ErrorPanel v-else-if="error" :error="error" :retry="refresh" />
    <template v-else-if="model && me && snapshot.data.value">
      <div class="permission-tree__identity">
        <strong class="mono">@{{ me.login }}</strong>
        <span class="mono">{{ me.org }}</span>
        <span>GitHub：{{ me.github_role === 'admin' ? '组织所有者' : me.github_role === 'member' ? '组织成员' : '非当前组织成员' }}</span>
        <span>称号：{{ me.titles.map(title => title.label).join('、') || '无' }}</span>
      </div>
      <div class="permission-tree__summary" role="status">
        <TxTag :label="`已生效 ${counts.effective}`" color="var(--tx-color-success)" variant="soft" />
        <TxTag :label="`受限 ${counts.blocked}`" color="var(--tx-color-warning)" variant="soft" />
        <TxTag :label="`未授予 ${counts.ungranted}`" variant="plain" />
        <span>共 {{ model.details.size }} 项能力 · 最近读取 {{ fmtDate(snapshot.data.value.readAt) }}（北京时间）</span>
      </div>
      <TxAlert type="info" title="这是读取时的权限快照，不是操作许可" :closable="false">
        能力状态以服务端 /me 为准；来源按当前配置解释。接口分别读取，配置或组织身份变化后请刷新，实际操作仍由服务端校验。
      </TxAlert>
      <TxAlert v-if="model.warnings.length" type="warning" title="部分来源无法完整解释" :closable="false">
        <ul class="permission-tree__warnings"><li v-for="warning in model.warnings" :key="warning">{{ warning }}</li></ul>
      </TxAlert>

      <div class="permission-tree__layout">
        <section ref="treeRegion" class="permission-tree__browse" tabindex="-1" aria-label="浏览权限树">
          <TxTabs v-model="view" placement="top" :content-scrollable="false" :content-padding="0" :animation="{ content: false, size: false }">
            <TxTabItem :name="views[0]" icon-class="i-carbon-chart-network">
              <p class="permission-tree__hint">能力域是分类，不是称号高低关系。</p>
            </TxTabItem>
            <TxTabItem :name="views[1]" icon-class="i-carbon-user-multiple">
              <p class="permission-tree__hint">包含全部当前配置；只有标记「当前来源」的配置参与我的权限解释。</p>
            </TxTabItem>
          </TxTabs>
          <label class="permission-tree__search-label">
            <span>搜索能力、ID 或来源名称</span>
            <TxSearchInput ref="searchInput" v-model="query" placeholder="例如 applications.read 或部门名称" aria-label="搜索能力、ID 或来源名称" />
          </label>
          <div class="permission-tree__tools">
            <TxButton size="sm" :disabled="searching || !nodes.length" @click="expandAll">全部展开</TxButton>
            <TxButton size="sm" :disabled="searching || !nodes.length" @click="expanded[view] = []">全部收起</TxButton>
            <TxButton v-if="selected" size="sm" variant="ghost" @click="jumpToDetails">查看详情</TxButton>
          </div>
          <p class="permission-tree__hint">{{ searching ? '搜索保留祖先路径；清空后恢复原展开状态。' : '按 / 搜索，Esc 清空；方向键浏览，Enter 选择。' }}</p>
          <TxTree
            :key="view"
            :nodes="nodes"
            :model-value="selection[view]"
            :expanded-keys="expanded[view]"
            :filter-text="query"
            :filter-method="filterNode"
            :indent="12"
            aria-label="权限目录"
            @update:expanded-keys="rememberExpansion"
            @select="selectNode"
          >
            <template #item="{ node, expanded: isExpanded, hasChildren, selected: isSelected, toggleExpand }">
              <!-- The outer TxTree treeitem owns selection and keyboard events; only the caret stops bubbling. -->
              <div class="permission-tree__row" :class="{ 'permission-tree__row--selected': isSelected }">
                <TxButton
                  v-if="hasChildren"
                  class="permission-tree__caret"
                  variant="bare"
                  size="sm"
                  tabindex="-1"
                  :icon="isExpanded ? 'i-carbon-chevron-down' : 'i-carbon-chevron-right'"
                  :aria-label="`${isExpanded ? '收起' : '展开'}${node.label}`"
                  :disabled="searching"
                  @click.stop="toggleExpand()"
                />
                <span v-else class="permission-tree__leaf" aria-hidden="true" />
                <span v-if="nodeInfo(node)?.icon" :class="carbon(nodeInfo(node)?.icon)" aria-hidden="true" />
                <span class="permission-tree__node-text">
                  <span>{{ node.label }}</span>
                  <code v-if="nodeInfo(node)?.capability">{{ nodeInfo(node)?.capability }}</code>
                  <span v-if="nodeSource(node)" class="permission-tree__node-source">{{ sourceText(nodeSource(node)!) }}</span>
                </span>
                <TxTag v-if="nodeDetail(node)" :label="statusText(nodeDetail(node))" :color="statusColor(nodeDetail(node))" variant="soft" />
              </div>
            </template>
            <template #empty>
              <TxEmptyState :title="searching ? '没有匹配的权限' : '没有可展示的配置'" :description="searching ? '换一个关键词，或清空搜索查看全部。' : '服务端目录中没有这一视图的条目，可刷新后重试。'" size="small">
                <template #actions><TxButton v-if="query" size="sm" @click="query = ''">清空搜索</TxButton></template>
              </TxEmptyState>
            </template>
          </TxTree>
        </section>

        <section ref="detailsRegion" class="permission-tree__details" tabindex="-1" aria-label="所选权限详情">
          <TxButton class="permission-tree__back" variant="ghost" size="sm" icon="i-carbon-arrow-up" @click="backToTree">返回权限树</TxButton>
          <template v-if="detail && boundary">
            <header>
              <h3>{{ detail.label }}</h3>
              <code>{{ detail.id }}</code>
              <p>{{ detail.description || '目录未提供能力说明。' }}</p>
              <div class="permission-tree__tags">
                <TxTag :label="statusText(detail)" :color="statusColor(detail)" variant="soft" />
                <TxTag v-if="boundary.reserved" label="预留能力 · 尚无执行入口" variant="plain" />
              </div>
            </header>
            <p v-if="detail.reason" class="permission-tree__reason">
              {{ detail.reason === 'github_admin_required' ? '称号配置包含此能力，但需要 GitHub 组织所有者身份，当前被 GitHub 权限上限挡住。' : '此能力要求当前 GitHub 组织成员身份，当前被组织成员资格限制。' }}
            </p>
            <p v-else-if="detail.status === 'ungranted'" class="permission-tree__hint">/me 未返回此能力的有效或受限记录；配置中出现它不代表我已获得。</p>
            <p v-else class="permission-tree__hint">/me 已确认此能力；仍需遵守下方的操作范围与执行边界。</p>

            <h4>我的授予来源</h4>
            <ul v-if="currentGrants.length" class="permission-tree__grants">
              <li v-for="grant in currentGrants" :key="`${grant.sourceKey}:${grant.kind}`">
                <strong>{{ grant.label }}</strong><span>{{ grantText(grant.kind) }} · 当前来源</span>
                <p v-if="grant.kind === 'implied'">由 {{ grant.via.map(capabilityLabel).join('、') }} 隐含授予。</p>
              </li>
            </ul>
            <p v-else class="permission-tree__hint">当前配置未解释出我的授予来源；不据此改变 /me 的能力状态。</p>
            <h4>其它配置来源（不授予我）</h4>
            <ul v-if="configuredGrants.length" class="permission-tree__grants">
              <li v-for="grant in configuredGrants" :key="`${grant.sourceKey}:${grant.kind}`">
                <strong>{{ grant.label }}</strong><span>{{ grantText(grant.kind) }} · {{ sourceIndex.get(grant.sourceKey)?.archived ? '已归档' : '非当前来源' }}</span>
                <p v-if="grant.kind === 'implied'">由 {{ grant.via.map(capabilityLabel).join('、') }} 隐含包含。</p>
              </li>
            </ul>
            <p v-else class="permission-tree__hint">没有其它配置来源。</p>

            <h4>能力关系</h4>
            <p class="permission-tree__hint">以下为配置中的传递隐含关系，不是额外授权。</p>
            <p>包含：<span v-if="!detail.implies.length" class="muted">无</span></p>
            <div class="permission-tree__relations"><TxButton v-for="id in detail.implies" :key="id" variant="ghost" size="sm" @click="inspectCapability(id)">{{ capabilityLabel(id) }} <code>{{ id }}</code></TxButton></div>
            <p>由这些能力包含：<span v-if="!detail.impliedBy.length" class="muted">无</span></p>
            <div class="permission-tree__relations"><TxButton v-for="id in detail.impliedBy" :key="id" variant="ghost" size="sm" @click="inspectCapability(id)">{{ capabilityLabel(id) }} <code>{{ id }}</code></TxButton></div>
            <h4>范围与执行边界</h4>
            <p>{{ boundary.scope }}</p>
            <p>{{ boundary.execution }}</p>
            <h4>关联页面</h4>
            <ul v-if="boundary.pages.length" class="permission-tree__pages"><li v-for="page in boundary.pages" :key="page.path"><RouterLink :to="page.path">{{ page.label }}</RouterLink></li></ul>
            <p v-else class="permission-tree__hint">没有独立的控制台页面。</p>
            <p class="permission-tree__hint">链接只是导航，进入页面和提交操作仍会核对权限。</p>
          </template>
          <template v-else-if="source && selected">
            <h3>{{ source.label }}</h3>
            <TxTag :label="sourceText(source)" :variant="source.active ? 'soft' : 'plain'" />
            <p>{{ source.description || selected.description || '这是一个配置来源，不是能力等级。' }}</p>
            <p class="permission-tree__hint">{{ source.active ? '此来源参与当前账号的权限解释；各能力是否生效仍以 /me 为准。' : '此来源仅展示配置，不为当前账号授予权限。' }}</p>
            <h4>{{ source.kind === 'automatic' || source.key === 'title:admin' ? '自动包含' : '直接配置' }}</h4>
            <div v-if="source.direct.length" class="permission-tree__relations"><TxButton v-for="id in source.direct" :key="id" size="sm" variant="ghost" @click="inspectCapability(id)">{{ capabilityLabel(id) }} <code>{{ id }}</code></TxButton></div>
            <p v-else class="permission-tree__hint">没有直接配置的能力。</p>
            <h4>隐含包含</h4>
            <div v-if="source.inherited.length" class="permission-tree__relations"><TxButton v-for="id in source.inherited" :key="id" size="sm" variant="ghost" @click="inspectCapability(id)">{{ capabilityLabel(id) }} <code>{{ id }}</code></TxButton></div>
            <p v-else class="permission-tree__hint">没有额外隐含能力。</p>
          </template>
          <template v-else-if="selected">
            <h3>{{ selected.label }}</h3>
            <p>{{ selected.description || '展开分类，选择一项能力查看来源、限制和关联页面。' }}</p>
            <p class="permission-tree__hint">此节点只是分类，不是授予来源或权限等级。</p>
          </template>
          <TxEmptyState v-else title="选择一项能力或来源" description="在左侧树中选择节点，查看当前状态、授予关系与执行边界；窄屏选择后会跳到这里。" size="small" />
        </section>
      </div>
      <footer class="permission-tree__caveats">
        <h3>如何理解这棵树</h3>
        <ul>
          <li>一个人可以有多个称号，能力合并计算；rank 仅用于显示顺序，不代表高称号自动继承低称号。</li>
          <li>GitHub 组织所有者自动获得全部能力，这是特殊规则，不是可手动指派的称号继承。</li>
          <li>称号与部门包不能越过 GitHub 权限上限；GitHub 管理操作仍要求相应组织角色。</li>
          <li>论坛操作还会核对当前组织成员资格和具体对象；这份控制台快照不能替代论坛实时鉴权。</li>
          <li>预留能力和「已生效」是两个维度：服务端可以返回能力，但尚未实现的执行入口不会因此出现。</li>
        </ul>
      </footer>
    </template>
    <TxEmptyState v-else title="权限数据尚未就绪" description="没有取得完整的目录、部门与身份，暂不展示权限结论。" size="small"><template #actions><TxButton @click="refresh">重新读取</TxButton></template></TxEmptyState>
  </section>
</template>

<style scoped>
.permission-tree { display: grid; gap: 16px; padding: 20px; min-width: 0; }
.permission-tree h2, .permission-tree h3, .permission-tree h4 { margin: 0; font-weight: 600; }
.permission-tree h2 { font-size: 1.125rem; }
.permission-tree h3 { font-size: 1rem; }
.permission-tree h4 { font-size: .875rem; margin-top: 20px; }
.permission-tree p { margin: 6px 0; line-height: 1.65; }
.permission-tree code { font-size: .75rem; overflow-wrap: anywhere; }
.permission-tree__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.permission-tree__header p, .permission-tree__hint, .permission-tree__summary, .permission-tree__identity { color: var(--tx-text-color-secondary); font-size: .8125rem; }
.permission-tree__identity, .permission-tree__summary, .permission-tree__tags, .permission-tree__tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.permission-tree__identity { overflow-wrap: anywhere; }
.permission-tree__identity strong { color: var(--tx-text-color-primary); }
.permission-tree__layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; align-items: start; }
.permission-tree__browse, .permission-tree__details { min-width: 0; scroll-margin-top: 24px; }
.permission-tree__browse { display: grid; gap: 12px; }
.permission-tree__details { border-left: 1px solid var(--tx-border-color-lighter); padding-left: 24px; font-size: .875rem; overflow-wrap: anywhere; }
.permission-tree__details:focus-visible, .permission-tree__browse:focus-visible { outline: 2px solid var(--tx-color-primary); outline-offset: 4px; }
.permission-tree__search-label { display: grid; gap: 6px; font-size: .8125rem; }
.permission-tree__row { display: flex; align-items: center; gap: 6px; min-width: 0; min-height: 52px; padding: 6px; border-radius: 8px; cursor: pointer; }
.permission-tree__row:hover { background: var(--tx-fill-color-light); }
.permission-tree__row--selected, .permission-tree__row--selected:hover { background: color-mix(in srgb, var(--tx-color-primary) 10%, transparent); }
.permission-tree__caret, .permission-tree__leaf { flex: 0 0 32px; width: 32px; }
.permission-tree__caret { min-width: 32px; max-width: 32px; min-height: 36px; padding: 0; }
.permission-tree__node-text { flex: 1; min-width: 0; display: grid; gap: 2px; overflow-wrap: anywhere; font-size: .875rem; }
.permission-tree__node-text code, .permission-tree__node-source { color: var(--tx-text-color-secondary); font-size: .6875rem; }
.permission-tree__row :deep(.tx-tag) { flex-shrink: 0; }
.permission-tree__back { margin-bottom: 12px; }
.permission-tree__reason { color: var(--tx-color-warning); }
.permission-tree__grants, .permission-tree__warnings, .permission-tree__pages { margin: 8px 0; padding-left: 20px; }
.permission-tree__grants li { margin: 8px 0; }
.permission-tree__grants strong, .permission-tree__grants span { display: block; }
.permission-tree__grants span, .permission-tree__grants p { color: var(--tx-text-color-secondary); font-size: .8125rem; }
.permission-tree__relations { display: flex; flex-wrap: wrap; gap: 4px; }
.permission-tree__relations :deep(button) { height: auto; min-height: 36px; max-width: 100%; white-space: normal; text-align: left; }
.permission-tree__relations code { margin-left: 4px; }
.permission-tree__pages a { color: var(--tx-color-primary); }
.permission-tree__caveats { border-top: 1px solid var(--tx-border-color-lighter); padding-top: 16px; color: var(--tx-text-color-secondary); font-size: .8125rem; line-height: 1.8; }
.permission-tree__caveats h3 { color: var(--tx-text-color-primary); font-size: .875rem; }
.permission-tree__caveats ul { padding-left: 20px; margin: 8px 0 0; }
@media (max-width: 900px) {
  .permission-tree { padding: 16px 12px; }
  .permission-tree__layout { grid-template-columns: minmax(0, 1fr); }
  .permission-tree__details { border-left: 0; border-top: 1px solid var(--tx-border-color-lighter); padding: 20px 0 0; }
  .permission-tree__header { flex-wrap: wrap; }
  .permission-tree__row { flex-wrap: wrap; }
  .permission-tree__node-text { flex-basis: calc(100% - 64px); }
  .permission-tree__row > :last-child:not(.permission-tree__node-text) { margin-left: 38px; }
  .permission-tree__tools :deep(button), .permission-tree__back, .permission-tree__relations :deep(button) { min-height: 44px; }
}
</style>
