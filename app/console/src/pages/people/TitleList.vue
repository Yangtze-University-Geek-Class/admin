<script setup lang="ts">
import { computed, ref } from "vue";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxTag } from "@talex-touch/tuffex/tag";
import TitleBadge from "../../components/TitleBadge.vue";
import TitleDialog from "./TitleDialog.vue";
import type { Catalogue, CatalogueTitle } from "../../lib/types";

/**
 * 「称号」分区：按层级列出全部称号的徽章、名字、英文标签、说明和权限，每个都能编辑。
 * 只有持有 roles.manage 的人看得到这个分区（服务端也只认这项能力）。名字、说明、权限全部来自 catalogue。
 */
const props = defineProps<{ catalogue: Catalogue }>();
const emit = defineEmits<{ changed: [] }>();

const ordered = computed(() => [...props.catalogue.titles].sort((a, b) => a.rank - b.rank));
const permissions = (title: CatalogueTitle) => {
  const bundle = props.catalogue.role_base[title.id] ?? [];
  return props.catalogue.capabilities.filter(item => bundle.includes(item.id)).map(item => item.label);
};

/** 代码里固定的规则（名字和说明可以改，这些不随之改变）。 */
function note(title: CatalogueTitle): string {
  if (title.id === "admin") return "GitHub 组织的所有者自动获得，不能指派，权限固定为全部。";
  if (title.id === "head") return `徽章显示为「部门名 · ${title.label}」，用部门的图标和色调；另加部门的权限包。`;
  if (title.id === "member") return `有部门时徽章显示为「部门名 · ${title.label}」，用部门的图标和中性色调，另加部门的权限包。GitHub 组织的成员没有别的称号时自动获得。`;
  if (title.id === "guest") return "没有任何称号的人，不能指派，没有权限。";
  return "";
}

const editing = ref<CatalogueTitle | null>(null);
const editOpen = computed({ get: () => editing.value !== null, set: value => { if (!value) editing.value = null; } });
</script>

<template>
  <div class="title-list">
    <p class="title-list__intro">称号的名字、英文标签、图标、色调、说明和权限都可以在这里改，保存后立即生效。</p>
    <article v-for="title in ordered" :key="title.id" class="title-item">
      <div class="title-item__head">
        <span class="title-item__badge"><TitleBadge :title="{ ...title, department: null }" size="md" /></span>
        <div class="title-item__text">
          <h3>
            {{ title.label }}
            <span class="mono title-item__tag">{{ title.tag }}</span>
          </h3>
          <p class="muted">{{ title.description || "没有填写说明" }}</p>
          <p v-if="note(title)" class="title-item__note">{{ note(title) }}</p>
        </div>
        <TxButton size="sm" icon="i-carbon-edit" :aria-label="`编辑「${title.label}」`" @click="editing = title">编辑</TxButton>
      </div>
      <div class="title-item__caps">
        <h4>权限</h4>
        <div class="tags">
          <TxTag v-if="title.id === 'admin'" label="全部权限" size="sm" variant="soft" />
          <span v-else-if="title.id === 'guest' || !permissions(title).length" class="muted">没有权限</span>
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
.title-list {
  display: flex;
  flex-direction: column;
}
.title-list__intro {
  margin: 0;
  padding: 12px 20px;
  font-size: 13px;
  color: var(--tx-text-color-secondary);
  border-bottom: 1px solid var(--tx-border-color-lighter);
}
.title-item {
  padding: 16px 20px;
  border-bottom: 1px solid var(--tx-border-color-lighter);
}
.title-item:last-child {
  border-bottom: 0;
}
.title-item__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 12px;
}
.title-item__badge {
  flex: 0 0 132px;
  padding-top: 2px;
}
.title-item__text {
  flex: 1 1 260px;
  min-width: 0;
}
.title-item__text h3 {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.title-item__tag {
  font-size: 12px;
  font-weight: 400;
  color: var(--tx-text-color-secondary);
}
.title-item__text p {
  margin: 2px 0 0;
  font-size: 13px;
}
.title-item__note {
  color: var(--tx-text-color-secondary);
}
.title-item__caps {
  margin-top: 12px;
  padding-left: 144px;
}
.title-item__caps h4 {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--tx-text-color-secondary);
}
@media (max-width: 900px) {
  .title-item__badge {
    flex-basis: 100%;
  }
  .title-item__caps {
    padding-left: 0;
  }
}
</style>
