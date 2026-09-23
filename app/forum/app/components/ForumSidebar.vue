<script setup lang="ts">
import type { SidebarNavItem } from '@talex-touch/tuffex/sidebar-nav'
import { toast } from '@talex-touch/tuffex/utils'

// Discourse's left sidebar (社区 / 类别 / 标签 / 我的) on top of TxSidebarNav.
// Rendered once per viewport mode: as a column on desktop, inside a drawer
// otherwise; `navigate` lets the drawer close after a pick.
const emit = defineEmits<{ navigate: [path: string] }>()

const forum = useForumStore()
const { user } = useCurrentUser()
const { loginOpen } = useShell()
const { isSnapshot, siteName } = useContentSource()
const { groups, items, active, dotColors, select } = useForumNav()
const router = useRouter()

const query = ref('')
const resetOpen = ref(false)

const workspace = computed(() => ({ name: siteName, description: isSnapshot ? '只读快照' : '开发者社区' }))

function onSelect(item: SidebarNavItem) {
  select(item)
  emit('navigate', String(item.value))
}

function goTo(path: string) {
  void router.push(path)
  emit('navigate', path)
}

function confirmReset() {
  forum.reset()
  resetOpen.value = false
  toast({ title: '已恢复示例数据', variant: 'success' })
}
</script>

<template>
  <div class="sidebar-tuned">
    <TxSidebarNav
      v-model:query="query"
      :model-value="active"
      :items="items"
      :groups="groups"
      :workspace="workspace"
      search-placeholder="筛选侧栏"
      search-hint="/"
      aria-label="站点导航"
      workspace-label="站点"
      class="[--tx-bui-sidebar-nav-width:100%]"
      @select="onSelect"
    >
      <!--
        The 极客班 logo instead of the letter chip, composed from TxCardItem
        rather than TxSidebarNav's internal workspace classes. The logo is
        decorative: the row's accessible name is the visible site name.
        The site blurb goes in `description`, not `subtitle`: the footer's
        signed-in card is the sidebar's only subtitle, which the upstream
        shell check reads as `@<handle> · <role>`.
      -->
      <template #workspace>
        <TxCardItem
          clickable
          role="link"
          align="center"
          :title="workspace.name"
          :description="workspace.description"
          class="mb-2 [--tx-card-item-gap:10px] [--tx-card-item-padding:6px]"
          @click="goTo('/')"
        >
          <template #avatar>
            <img src="/logo.png" alt="" class="block h-8 w-8 rounded-lg object-contain">
          </template>
        </TxCardItem>
      </template>

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

      <template #footer>
        <TxStack :gap="8">
          <TxCardItem
            v-if="user"
            clickable
            :title="user.displayName"
            :subtitle="`@${user.username} · ${roleLabel(user.role)}`"
            @click="goTo(`/u/${user.username}`)"
          >
            <template #avatar>
              <UserAvatar :user="user" size="small" />
            </template>
          </TxCardItem>
          <TxButton v-else variant="primary" block @click="loginOpen = true">
            登录
          </TxButton>
          <!--
            The sample data belongs to this browser rather than to the signed-in
            identity, so a guest who inherited someone's edits can restore it too.
            The read-only snapshot has nothing to reset.
          -->
          <TxButton v-if="!isSnapshot" variant="ghost" size="sm" icon="i-carbon-reset" @click="resetOpen = true">
            重置示例数据
          </TxButton>
        </TxStack>
      </template>
    </TxSidebarNav>
  </div>

  <TxModal v-if="!isSnapshot" v-model="resetOpen" title="重置示例数据">
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
