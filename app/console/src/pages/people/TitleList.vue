<script setup lang="ts">
import { computed, ref } from "vue";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxTag } from "@talex-touch/tuffex/tag";
import TitleBadge from "../../components/TitleBadge.vue";
import TitleDialog from "./TitleDialog.vue";
import type { Catalogue, CatalogueTitle } from "../../lib/types";

/**
 * 「称号」分区：按层级列出全部称号的徽章、名字、英文标签、说明和权限。
 * 只有持有 roles.manage 的人看得到这个分区（服务端也只认这项能力）；最高的两级（admin、captain）只有 admin 本人能改，
 * 与服务端的 admiral_required 一致。名字、说明、权限全部来自 catalogue。
 */
const props = defineProps<{ catalogue: Catalogue; admiral: boolean }>();
const editable = (title: CatalogueTitle) => props.admiral || (title.id !== "admin" && title.id !== "captain");
const adminLabel = computed(() => props.catalogue.titles.find(item => item.id === "admin")?.label ?? "");
const emit = defineEmits<{ changed: [] }>();

const ordered = computed(() => [...props.catalogue.titles].sort((a, b) => a.rank - b.rank));
const permissions = (title: CatalogueTitle) => {
  const bundle = props.catalogue.role_base[title.id] ?? [];
  return props.catalogue.capabilities.filter(item => bundle.includes(item.id)).map(item => item.label);
};

/** 代码里固定的规则（名字和说明可以改，这些不随之改变）。 */
function note(title: CatalogueTitle): string {
  if (title.id === "admin") return "由 GitHub 组织所有者自动获得，不能指派。";
  if (title.id === "head") return "任职部门的权限会叠加在此称号之上。";
  if (title.id === "member") return "组织成员自动获得；加入部门后叠加部门权限。";
  if (title.id === "guest") return "没有称号和权限，不能指派。";
  return "";
}

const editing = ref<CatalogueTitle | null>(null);
const editOpen = computed({ get: () => editing.value !== null, set: value => { if (!value) editing.value = null; } });
</script>

<template>
  <div class="title-list">
    <div class="title-list__heading"><h2>称号</h2><span>{{ ordered.length }} 个</span></div>
    <article v-for="title in ordered" :key="title.id" class="title-item">
      <div class="title-item__head">
        <div class="title-item__text">
          <h3><TitleBadge :title="{ ...title, department: null }" size="md" /><span class="mono title-item__tag">{{ title.tag }}</span></h3>
          <p class="muted">{{ title.description || "没有填写说明" }}</p>
          <p v-if="note(title)" class="title-item__note">{{ note(title) }}</p>
        </div>
        <span class="title-item__count">{{ title.id === 'admin' ? '全部权限' : `${permissions(title).length} 项基础权限` }}</span>
        <TxButton v-if="editable(title)" size="sm" icon="i-carbon-edit" :aria-label="`编辑「${title.label}」`" @click="editing = title">编辑</TxButton>
        <span v-else class="muted title-item__locked">只有{{ adminLabel }}能改</span>
      </div>
      <div v-if="title.id !== 'guest'" class="title-item__caps">
        <div class="tags">
          <TxTag v-if="title.id === 'admin'" label="全部权限" size="sm" variant="soft" />
          <span v-else-if="!permissions(title).length" class="muted">没有配置基础权限</span>
          <template v-else>
            <TxTag v-for="label in permissions(title)" :key="label" :label="label" size="sm" variant="plain" />
          </template>
        </div>
      </div>
    </article>

    <TitleDialog v-model:open="editOpen" :title="editing" :catalogue="catalogue" @done="emit('changed')" />
  </div>
</template>

<style scoped>
.title-item__locked {
  flex: 0 0 auto;
  font-size: 12px;
}
.title-list {
  display: flex;
  flex-direction: column;
}
.title-list__heading {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 20px 24px 14px;
  border-bottom: 1px solid var(--tx-border-color-lighter);
}
.title-list__heading h2 { margin: 0; font-size: 18px; font-weight: 650; }
.title-list__heading span { font-size: 13px; color: var(--tx-text-color-secondary); }
.title-item {
  padding: 22px 24px;
  border-bottom: 1px solid var(--tx-border-color-lighter);
}
.title-item:last-child {
  border-bottom: 0;
}
.title-item__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 20px;
}
.title-item__text {
  flex: 1 1 320px;
  min-width: 0;
}
.title-item__text h3 {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 16px;
  font-weight: 650;
}
.title-item__tag {
  font-size: 12px;
  font-weight: 400;
  color: var(--tx-text-color-secondary);
}
.title-item__text p {
  margin: 6px 0 0;
  font-size: 13px;
}
.title-item__note {
  color: var(--tx-text-color-secondary);
}
.title-item__count {
  color: var(--tx-text-color-secondary);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.title-item__caps {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--tx-border-color-lighter);
}
@media (max-width: 900px) {
  .title-item__head {
    align-items: flex-start;
  }
  .title-item__count {
    flex-basis: 100%;
  }
}
</style>
