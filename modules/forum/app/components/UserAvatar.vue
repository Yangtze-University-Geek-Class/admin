<script setup lang="ts">
import type { AvatarSize } from '@talex-touch/tuffex/avatar'
import type { User } from '~/data/types'

// Initials avatar coloured per user. `clickable` turns it into a link to the
// user's page; leave it off when a parent control owns the click.
const props = withDefaults(defineProps<{
  user: User
  size?: AvatarSize
  clickable?: boolean
}>(), {
  size: 'medium',
  clickable: false,
})

function open() {
  if (props.clickable)
    void navigateTo(`/u/${props.user.username}`)
}
</script>

<template>
  <TxAvatar
    :src="user.avatarUrl"
    :name="user.displayName"
    :alt="user.displayName"
    :background-color="user.avatarColor"
    :size="size"
    :clickable="clickable"
    @click="open"
  />
</template>
