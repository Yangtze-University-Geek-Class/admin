<script setup lang="ts">
import type { SidebarNavItem } from '@talex-touch/tuffex/sidebar-nav'
import { toast } from '@talex-touch/tuffex/utils'

// Discourse's left sidebar (社区 / 类别 / 标签 / 我的) on top of TxSidebarNav.
// Rendered once per viewport mode: as a column on desktop, inside a drawer
// otherwise; `navigate` lets the drawer close after a pick.
const emit = defineEmits<{ navigate: [path: string] }>()

const forum = useForumStore()
const { siteLogin } = useContentSource()
const { groups, items, active, dotColors, select } = useForumNav()

const query = ref('')
const resetOpen = ref(false)

function onSelect(item: SidebarNavItem) {
  select(item)
  emit('navigate', String(item.value))
}

function confirmReset() {
  forum.reset()
  resetOpen.value = false
  toast({ title: '已恢复示例数据', variant: 'success' })
}
</script>

<template>
  <div class="sidebar-tuned">
    <!--
      No `workspace` prop: TxSidebarNav would draw its own switcher chip there.
      The 极客班 logo and the site name sit in ForumHeader's top-left, and the
      account only in its avatar menu, so the filter field is the first row.
    -->
    <TxSidebarNav
      v-model:query="query"
      :model-value="active"
      :items="items"
      :groups="groups"
      search-placeholder="筛选侧栏"
      search-hint="/"
      aria-label="站点导航"
      class="[--tx-bui-sidebar-nav-width:100%]"
      @select="onSelect"
    >
      <!--
        Category rows keep both cues: the category icon, and upstream's colour
        dot pinned to its corner (the icon box is too narrow to sit them side
        by side). Other rows show their icon alone.
      -->
      <template #item-icon="{ item }">
        <span v-if="dotColors.has(item.value)" class="relative inline-flex">
          <i v-if="item.icon" :class="item.icon" aria-hidden="true" />
          <TxBadge
            dot
            :color="dotColors.get(item.value)"
            class="pointer-events-none absolute -bottom-0.5 -right-1"
          />
        </span>
        <i v-else-if="item.icon" :class="item.icon" aria-hidden="true" />
      </template>

      <!--
        The sample data belongs to this browser rather than to the signed-in
        identity, so a guest who inherited someone's edits can restore it too.
        The read-only snapshot has nothing to reset, and under the site-wide
        login nothing is kept in this browser, so there is no footer at all.
      -->
      <template v-if="!siteLogin" #footer>
        <TxButton variant="ghost" size="sm" icon="i-carbon-reset" class="mt-2" @click="resetOpen = true">
          重置示例数据
        </TxButton>
      </template>
    </TxSidebarNav>
  </div>

  <TxModal v-if="!siteLogin" v-model="resetOpen" title="重置示例数据">
    <p class="text-$tx-text-color-secondary">
      这会丢弃你在本机创建的话题、回复、点赞、书签和资料修改，恢复到内置的示例数据。此操作不可撤销。
    </p>
    <template #footer>
      <TxFlex justify="flex-end" :gap="8">
        <TxButton variant="secondary" @click="resetOpen = false">
          取消
        </TxButton>
        <TxButton variant="danger" @click="confirmReset">
          确认重置
        </TxButton>
      </TxFlex>
    </template>
  </TxModal>
</template>
