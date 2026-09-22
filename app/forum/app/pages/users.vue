<script setup lang="ts">
import type { DataTableColumn } from '@talex-touch/tuffex/data-table'
import type { User } from '~/data/types'

// Discourse's /users: the member directory as a sortable table with a filter
// box. The whole directory is one page, so the table sorts it on the client.
useHead({ title: '用户' })

interface DirectoryRow {
  id: string
  user: User
  displayName: string
  role: string
  roleRank: number
  likesReceived: number
  topics: number
  replies: number
  joinedAt: number
}

const forum = useForumStore()
const router = useRouter()
const { formatDate } = useRelativeTime()
const { href } = useAppLink()

const query = ref('')

const columns: DataTableColumn<DirectoryRow>[] = [
  { key: 'user', title: '用户', auto: true, sortable: true, dataIndex: 'displayName' },
  { key: 'role', title: '角色', width: 90, sortable: true, sorter: (a, b) => a.roleRank - b.roleRank },
  { key: 'likesReceived', title: '已收到的赞', width: 110, align: 'right', sortable: true },
  { key: 'topics', title: '话题', width: 80, align: 'right', sortable: true },
  { key: 'replies', title: '回复', width: 80, align: 'right', sortable: true },
  { key: 'joinedAt', title: '加入时间', width: 130, sortable: true },
]

const rows = computed<DirectoryRow[]>(() => {
  const needle = query.value.trim().toLowerCase()
  return forum.state.users
    .filter(user => !needle || user.username.toLowerCase().includes(needle) || user.displayName.toLowerCase().includes(needle))
    .map((user) => {
      const stats = forum.statsOfUser(user.id)
      return {
        id: user.id,
        user,
        displayName: user.displayName,
        role: roleLabel(user.role),
        roleRank: user.role === 'admin' ? 0 : user.role === 'moderator' ? 1 : 2,
        likesReceived: stats.likesReceived,
        topics: stats.topics,
        replies: stats.replies,
        joinedAt: user.joinedAt,
      }
    })
})

function open(user: User) {
  void router.push(`/u/${user.username}`)
}
</script>

<template>
  <TxCard>
    <template #header>
      <TxFlex align="center" :gap="12" justify="space-between" wrap="wrap">
        <h1 class="text-xl font-semibold">
          用户
        </h1>
        <TxSearchInput
          v-model="query"
          placeholder="搜索用户"
          clearable
        />
      </TxFlex>
    </template>

    <TxDataTable
      v-if="rows.length"
      hover
      :data="rows"
      :columns="columns"
      row-key="id"
      @row-click="open($event.row.user)"
    >
      <template #cell-user="{ row }: { row: DirectoryRow }">
        <TxFlex align="center" :gap="10">
          <UserAvatar :user="row.user" size="small" />
          <TxFlex direction="column" :gap="0" class="min-w-0">
            <TxCellLink
              :href="href(`/u/${row.user.username}`)"
              :label="row.user.displayName"
              @open="open(row.user)"
            />
            <span class="text-sm text-$tx-text-color-secondary">@{{ row.user.username }}</span>
          </TxFlex>
        </TxFlex>
      </template>

      <template #cell-role="{ row }: { row: DirectoryRow }">
        <TxStatusBadge :text="row.role" :status="roleTone(row.user.role)" size="sm" />
      </template>

      <template #cell-joinedAt="{ row }: { row: DirectoryRow }">
        <span class="text-$tx-text-color-secondary">{{ formatDate(row.joinedAt) }}</span>
      </template>
    </TxDataTable>

    <TxEmptyState
      v-else
      variant="search-empty"
      title="没有匹配的用户"
      description="换个名字或用户名试试"
    />
  </TxCard>
</template>
