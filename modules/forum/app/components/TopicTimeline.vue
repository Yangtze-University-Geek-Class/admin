<script setup lang="ts">
import type { Topic } from '~/data/types'

/**
 * The topic's right-hand rail: Discourse's timeline scrubber as a real
 * timeline, the two counts it shows beside it, and the participant row.
 */
const props = defineProps<{ topic: Topic }>()

const forum = useForumStore()
const { formatAbsolute } = useRelativeTime()

const participants = computed(() => forum.participants(props.topic.id))

interface Milestone {
  key: string
  title: string
  time?: string
  icon: string
  color: 'default' | 'primary' | 'success' | 'warning' | 'error'
}

// Pinning and closing carry no timestamp of their own in the data model, so
// they appear as states on the line rather than dated events.
const milestones = computed<Milestone[]>(() => {
  const list: Milestone[] = [
    { key: 'created', title: '创建', time: formatAbsolute(props.topic.createdAt), icon: 'i-carbon-flag', color: 'default' },
  ]
  if (props.topic.pinned)
    list.push({ key: 'pinned', title: '已置顶', icon: 'i-carbon-pin', color: 'warning' })
  if (props.topic.closed)
    list.push({ key: 'closed', title: '已关闭', icon: 'i-carbon-locked', color: 'error' })
  list.push({ key: 'latest', title: '最新回复', time: formatAbsolute(props.topic.lastActivityAt), icon: 'i-carbon-chat', color: 'primary' })
  return list
})
</script>

<template>
  <TxStack :gap="16">
    <TxCard variant="plain">
      <TxTimeline>
        <TxTimelineItem
          v-for="(milestone, index) in milestones"
          :key="milestone.key"
          :title="milestone.title"
          :time="milestone.time"
          :icon="milestone.icon"
          :color="milestone.color"
          :active="index === milestones.length - 1"
        />
      </TxTimeline>
    </TxCard>

    <TxGrid :cols="2" :gap="12">
      <TxStatCard
        :value="forum.replyCount(topic.id)"
        label="回复"
        icon-class="i-carbon-chat"
      />
      <TxStatCard
        :value="forum.likeCountOfTopic(topic.id)"
        label="点赞"
        icon-class="i-carbon-favorite"
      />
    </TxGrid>

    <TxCard variant="plain">
      <TxStack :gap="10">
        <span class="text-sm text-$tx-text-color-secondary">参与者</span>
        <TxAvatarGroup :max="8" size="small">
          <UserAvatar
            v-for="participant in participants"
            :key="participant.id"
            :user="participant"
          />
        </TxAvatarGroup>
      </TxStack>
    </TxCard>
  </TxStack>
</template>
