<script setup lang="ts">
import type { UserTitle } from '~/data/titles'
import { titleColor, titleIcon, titleLabel } from '~/data/titles'

/**
 * A user's 极客班 title as a TxTag: icon + Chinese label (the title's own
 * label, or 「{部门} · {head label}」 for a department head), on TxTag's
 * default outline recipe in the title's tone. Labels, icons and tones come from `/api/public/org` through
 * `useOrgTitles` (the console can rename them), with `app/data/titles.ts` as
 * the defaults until that answers; the badge redraws when it does.
 * Crew (member with a department) wears the neutral crew tone rather than
 * TxTag's `plain` variant: `plain` ignores `color` and paints the label in
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

// The palette hexes are tuned for the light surface; under `html.dark`
// `titleColor` lifts them toward Tuffex's own ink token.
const colorMode = useColorMode()
const dark = computed(() => colorMode.value === 'dark')
const org = useOrgTitles()

const badge = computed(() => {
  const title = props.title
  if (!title)
    return null
  return {
    label: titleLabel(title, org.value),
    icon: titleIcon(title, org.value),
    color: titleColor(title, dark.value, org.value),
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
