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
      <TxStack :gap="12">
        <TxCard
          v-for="category in categories"
          :key="category.id"
          class="cursor-pointer transition-colors hover:border-$tx-color-primary"
          @click="go(`/c/${category.slug}`)"
        >
          <div class="flex items-start justify-between gap-4">
            <div class="flex items-center gap-3">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-$tx-border-color-lighter bg-$tx-bg-color-page text-$tx-color-primary">
                <i v-if="category.icon" :class="[category.icon, 'text-xl']" aria-hidden="true" />
                <TxBadge v-else dot :color="category.color" />
              </div>
              <div>
                <h2 class="text-base font-semibold text-$tx-text-color-primary">
                  {{ category.name }}
                </h2>
                <p v-if="category.description" class="mt-1 text-sm text-$tx-text-color-secondary leading-normal">
                  {{ category.description }}
                </p>
              </div>
            </div>

            <TxBadge :value="forum.topicCountOfCategory(category.id)" class="shrink-0" />
          </div>

          <div v-if="recentOf(category).length" class="mt-3.5 border-t border-$tx-border-color-lighter flex flex-col gap-2 pl-13 pt-3">
            <div
              v-for="topic in recentOf(category)"
              :key="topic.id"
              class="flex items-center justify-between text-sm group"
              @click.stop="go(`/t/${topic.id}`)"
            >
              <span class="line-clamp-1 text-$tx-text-color-primary transition-colors group-hover:text-$tx-color-primary">
                {{ topic.title }}
              </span>
              <span class="ml-4 shrink-0 text-xs text-$tx-text-color-secondary">
                {{ fromNow(topic.lastActivityAt) }}
              </span>
            </div>
          </div>
        </TxCard>
      </TxStack>
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
