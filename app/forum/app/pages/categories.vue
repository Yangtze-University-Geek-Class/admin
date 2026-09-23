<script setup lang="ts">
import type { Category } from '~/data/types'

// Discourse's /categories: the category list on the left, a plain "最新" feed
// on the right (desktop only — on a phone the feed is what `/` already is).
useHead({ title: '类别' })

const RECENT_PER_CATEGORY = 2
const LATEST_COUNT = 10

const forum = useForumStore()
const router = useRouter()
const { isDesktop } = useShell()
const { fromNow } = useRelativeTime()
const { href } = useAppLink()

const categories = computed(() => forum.state.categories)

const latest = computed(() => forum.sortedTopics({ mode: 'latest' }).slice(0, LATEST_COUNT))

function recentOf(category: Category) {
  return forum.recentTopicsOfCategory(category.id, RECENT_PER_CATEGORY)
}

function go(path: string) {
  void router.push(path)
}
</script>

<template>
  <TxRow :gutter="24">
    <TxCol :span="24" :lg="14">
      <TxCard variant="plain" :padding="0">
        <template v-for="(category, index) in categories" :key="category.id">
          <!--
            A category row navigates, so it says so: TxCardItem has no implicit
            role. Snapshot/curation categories carry an icon; seed categories
            keep the colour dot.
          -->
          <TxCardItem
            clickable
            role="link"
            :title="category.name"
            :description="category.description"
            :icon-class="category.icon"
            avatar-shape="rounded"
            @click="go(`/c/${category.slug}`)"
          >
            <template v-if="!category.icon" #avatar>
              <TxBadge dot :color="category.color" />
            </template>
            <template #right>
              <TxBadge :value="forum.topicCountOfCategory(category.id)" />
            </template>
          </TxCardItem>

          <TxStack :gap="4" class="px-4 pb-3 pl-14">
            <TxCellLink
              v-for="topic in recentOf(category)"
              :key="topic.id"
              :href="href(`/t/${topic.id}`)"
              :label="topic.title"
              muted
              @open="go(`/t/${topic.id}`)"
            />
          </TxStack>

          <TxDivider v-if="index < categories.length - 1" />
        </template>
      </TxCard>
    </TxCol>

    <TxCol v-if="isDesktop" :span="24" :lg="10">
      <TxCard variant="plain" :padding="0">
        <template #header>
          <h2 class="text-base font-semibold">
            最新
          </h2>
        </template>
        <TxStack :gap="0">
          <TxCardItem
            v-for="topic in latest"
            :key="topic.id"
            clickable
            :title="topic.title"
            @click="go(`/t/${topic.id}`)"
          >
            <template #subtitle>
              <TxFlex align="center" :gap="6" wrap="wrap">
                <CategoryTag :category="forum.categoryById(topic.categoryId)" />
                <span class="text-$tx-text-color-secondary">{{ fromNow(topic.lastActivityAt) }}</span>
              </TxFlex>
            </template>
          </TxCardItem>
        </TxStack>
      </TxCard>
    </TxCol>
  </TxRow>
</template>
