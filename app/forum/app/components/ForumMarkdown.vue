<script setup lang="ts">
import { renderableMarkdown, WORD_JOINER } from '../../shared/post-markdown'

// A post body as others see it. Anyone can write one (guests too), so the
// text goes through `renderableMarkdown` first: raw HTML shows as text and
// links only go to http(s), mailto or the site itself (shared/post-markdown.ts).
// TxMarkdownView then sanitizes with DOMPurify as a second layer.
//
// The HTML escape is an invisible word joiner after `<`; copying code out of a
// post must not carry it into someone's compiler, so the copy handler drops it.
const props = defineProps<{ content: string }>()

const safe = computed(() => renderableMarkdown(props.content))

function onCopy(event: ClipboardEvent) {
  const text = window.getSelection()?.toString() ?? ''
  if (!text.includes(WORD_JOINER) || !event.clipboardData)
    return
  event.preventDefault()
  event.clipboardData.setData('text/plain', text.replaceAll(WORD_JOINER, ''))
}
</script>

<template>
  <div class="overflow-x-auto max-w-full" @copy="onCopy">
    <TxMarkdownView :content="safe" />
  </div>
</template>
