<script setup lang="ts">
import type { UserTitle } from '~/data/titles'
import { titleColor, titleIcon, titleLabel } from '~/data/titles'

/**
 * A user's 极客班 title as a TxTag: icon + Chinese label, e.g. 「班长」 or
 * 「社区部 · 负责人」, on TxTag's default outline recipe in the catalogue tone.
 * Crew (部门干事) wears the catalogue's neutral crew tone rather than TxTag's
 * `plain` variant: `plain` ignores `color` and paints the label in
 * `--tx-text-color-secondary`, which reads at under 3:1 on its own fill.
 * The label carries the meaning on its own, so the colour is decoration.
 *
 * No click listener on purpose: TxTag becomes a `role="button"` tab stop as
 * soon as it has one, and a title is metadata, not a control.
 */
const props = withDefaults(defineProps<{
  title?: UserTitle
  size?: 'sm' | 'md'
}>(), {
  title: undefined,
  size: 'sm',
})

// The catalogue hexes are tuned for the light surface; under `html.dark`
// `titleColor` lifts them toward Tuffex's own ink token.
const colorMode = useColorMode()
const dark = computed(() => colorMode.value === 'dark')

const badge = computed(() => {
  const title = props.title
  if (!title)
    return null
  return {
    label: titleLabel(title),
    icon: titleIcon(title),
    color: titleColor(title, dark.value),
  }
})
</script>

<template>
  <TxTag
    v-if="badge"
    :label="badge.label"
    :icon="badge.icon"
    :color="badge.color"
    :size="size"
  />
</template>
