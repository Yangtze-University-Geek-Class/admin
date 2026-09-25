<script setup lang="ts">
import dayjs from 'dayjs'
import { isStaff } from '~/data/permissions'
import { siteNameInText } from '../../shared/content-source'

useHead({ title: '关于' })

const forum = useForumStore()
const router = useRouter()
const { isSnapshot, isSite, siteName, snapshot } = useContentSource()
// 「关于 Tuff Forum」「关于极客班论坛」
const heading = `关于${siteNameInText(siteName).trimEnd()}`
const capturedAt = computed(() => snapshot.value.capturedAt ? dayjs(snapshot.value.capturedAt).format('YYYY-MM-DD HH:mm') : '')

const stats = computed(() => [
  { label: '用户', value: forum.state.users.length, icon: 'i-carbon-user-multiple' },
  { label: '话题', value: forum.state.topics.length, icon: 'i-carbon-forum' },
  { label: '帖子', value: forum.state.posts.filter(post => !post.deleted).length, icon: 'i-carbon-chat' },
])

/** Admins first, then moderators, each group by join date. */
const staff = computed(() =>
  forum.state.users
    .filter(user => isStaff(user))
    .sort((a, b) => Number(b.role === 'admin') - Number(a.role === 'admin') || a.joinedAt - b.joinedAt),
)

function open(username: string) {
  void router.push(`/u/${username}`)
}
</script>

<template>
  <TxStack :gap="24">
    <DeploymentInfo />
    <TxCard>
      <template #header>
        <h1 class="text-2xl font-semibold">
          {{ heading }}
        </h1>
      </template>
      <!-- 极客班论坛（部署的镜像）：还没有帖子和成员资料，所以下面的数字和管理团队不显示 -->
      <TxStack v-if="isSite" :gap="12" class="leading-relaxed">
        <p>
          长江大学极客班的论坛。发帖、回复和旧帖迁移正在接入，现在可以看到论坛的分类和标签。
        </p>
        <p class="text-$tx-text-color-secondary">
          登录用 GitHub 账号，官网、论坛、控制台共用同一次登录。
        </p>
        <p class="text-sm text-$tx-text-color-secondary">
          论坛基于开源项目 Tuff Forum（<a href="https://github.com/talex-touch/tuff-forum" class="text-$tx-color-primary underline" target="_blank" rel="noopener noreferrer">talex-touch/tuff-forum</a>，MIT 许可）搭建。
        </p>
      </TxStack>
      <TxStack v-else-if="isSnapshot" :gap="12" class="leading-relaxed">
        <p>
          极客班论坛正在迁移到基于 Tuff Forum 与 <code>@talex-touch/tuffex</code> 的新前端。
          当前显示极客班论坛的公开内容<template v-if="capturedAt">（更新于 {{ capturedAt }}）</template>：
          成员资料、分类、话题与回复；已删除内容、私信、密码和会话不会出现在这里。
        </p>
        <p class="text-$tx-text-color-secondary">
          登录用 GitHub 账号，官网、论坛、控制台共用同一次登录。发帖、回复和资料修改正在接入。
        </p>
      </TxStack>
      <TxStack v-else :gap="12" class="leading-relaxed">
        <p>
          Tuff Forum 是 Tuff / talex-touch 开发者社区的演示论坛：一个纯前端、数据全部来自内置示例的 Discourse 式站点，
          用来检验 <code>@talex-touch/tuffex</code> 作为 npm 组件库在真实业务形态下的组合能力。
        </p>
        <p class="text-$tx-text-color-secondary">
          这里没有后端。你发的帖子、点的赞、收藏的书签都只保存在这台设备的浏览器里，随时可以在侧栏底部「重置示例数据」。
        </p>
      </TxStack>
    </TxCard>

    <TxGrid v-if="!isSite" :cols="{ xs: 1, sm: 3 }" :gap="12">
      <TxStatCard
        v-for="stat in stats"
        :key="stat.label"
        :label="stat.label"
        :value="stat.value"
        :icon-class="stat.icon"
      />
    </TxGrid>

    <TxCard v-if="!isSite">
      <template #header>
        <h2 class="text-lg font-semibold">
          管理团队
        </h2>
      </template>
      <TxStack :gap="4">
        <TxCardItem
          v-for="user in staff"
          :key="user.id"
          clickable
          :title="user.displayName"
          :subtitle="`@${user.username}`"
          :description="user.bio"
          @click="open(user.username)"
        >
          <template #avatar>
            <UserAvatar :user="user" size="medium" />
          </template>
          <template #right>
            <TxStatusBadge :text="roleLabel(user.role)" :status="roleTone(user.role)" size="sm" />
          </template>
        </TxCardItem>
      </TxStack>
    </TxCard>
  </TxStack>
</template>
