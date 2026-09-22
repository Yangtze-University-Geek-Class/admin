<script setup lang="ts">
import type { Category } from '~/data/types'

// Discourse's category badge: the category's colour as a dot, its name in
// neutral chrome. `clickable` is opt-in because most of these sit inside a
// clickable row, and a button inside a button is not a control anyone can use.
const props = withDefaults(defineProps<{
  category: Category | undefined
  clickable?: boolean
}>(), {
  clickable: false,
})

const router = useRouter()

// TxTag turns itself into a `role="button"` tab stop as soon as it is given a
// click listener, so the listener has to be absent when it is decoration.
const listeners = computed(() => (props.clickable ? { click: open } : {}))

function open(event: MouseEvent) {
  // The row underneath is clickable too; without this the tag would navigate
  // to the category and the row to the topic.
  event.stopPropagation()
  if (props.category)
    void router.push(`/c/${props.category.slug}`)
}
</script>

<template>
  <TxTag
    v-if="category"
    :label="category.name"
    :dot="category.color"
    variant="plain"
    size="sm"
    v-on="listeners"
  />
</template>
