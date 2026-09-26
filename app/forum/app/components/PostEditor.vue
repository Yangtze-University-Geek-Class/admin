<script setup lang="ts">
/**
 * Where a post body is written: new topics, replies (quotes included) and edits.
 *
 * 编辑 is a plain textarea holding the raw Markdown. 分栏 puts the same textarea
 * next to the rendered result, which follows every keystroke; below 42rem of
 * room the two stack instead of squeezing into columns. 预览 shows the result
 * only. The textarea stays mounted while it is hidden, so switching modes keeps
 * the text, the cursor and the undo history.
 *
 * A new editor starts in 编辑, and every use of it should (#144). A caller that
 * keeps it mounted between uses gives it a new `key` per use, as the reply
 * drawer does on every open; PostCard's edit form mounts it per edit anyway.
 *
 * The result is `ForumMarkdown`, the component that shows posts on the topic
 * page, so the preview is what readers will see: raw HTML shows as text and
 * links only go where posts may link. The text itself is never rewritten, which
 * is why someone else's post can come in as it is (a quote, a moderator's edit).
 */
type Mode = 'edit' | 'split' | 'preview'

const props = withDefaults(defineProps<{
  placeholder?: string
  /** What screen readers call the textarea (its aria-label), e.g. 「回复内容」; the mode switch is named after it. */
  label: string
  /** In px; the three heights the forum uses map to static classes below. */
  minHeight?: 200 | 240 | 320
}>(), { placeholder: '', minHeight: 240 })

const content = defineModel<string>({ required: true })

const MODES: { value: Mode, label: string, icon: string }[] = [
  { value: 'edit', label: '编辑', icon: 'i-ri-edit-line' },
  { value: 'split', label: '分栏', icon: 'i-ri-layout-column-line' },
  { value: 'preview', label: '预览', icon: 'i-ri-eye-line' },
]

// Each pane's min height, spelled out so UnoCSS finds the classes (app/ has no
// inline styles); `!` because TxTextarea's own scoped rule (min-height: 96px)
// outranks a plain utility. When 分栏 stacks, the two panes share the height,
// so the editor keeps its size in every mode and still fits the reply drawer.
const HEIGHT_CLASS = {
  200: { whole: '!min-h-50', shared: '!min-h-24 @2xl:!min-h-50' },
  240: { whole: '!min-h-60', shared: '!min-h-28 @2xl:!min-h-60' },
  320: { whole: '!min-h-80', shared: '!min-h-38 @2xl:!min-h-80' },
} as const

const mode = ref<Mode>('edit')
const heightClass = computed(() => HEIGHT_CLASS[props.minHeight][mode.value === 'split' ? 'shared' : 'whole'])
</script>

<template>
  <div class="@container w-full flex flex-col gap-2" data-post-editor>
    <TxRadioGroup v-model="mode" class="self-start" :aria-label="`${label}的显示方式`">
      <TxRadio v-for="item in MODES" :key="item.value" :value="item.value">
        <span class="inline-flex items-center gap-1">
          <span :class="item.icon" aria-hidden="true" />
          {{ item.label }}
        </span>
      </TxRadio>
    </TxRadioGroup>

    <div class="grid gap-3" :class="{ '@2xl:grid-cols-2': mode === 'split' }">
      <div v-show="mode !== 'preview'" class="min-w-0">
        <TxTextarea
          v-model="content"
          class="h-full"
          :class="heightClass"
          :placeholder="placeholder"
          :aria-label="label"
        />
      </div>

      <!--
        In 分栏 the textarea sets the row height and the result scrolls inside
        it, so a long post does not stretch the textarea next to it.
      -->
      <div
        v-if="mode !== 'edit'"
        class="relative min-w-0 rounded-xl border border-$tx-border-color border-dashed"
        :class="heightClass"
        data-editor-preview
      >
        <div class="px-3 py-2" :class="{ 'absolute inset-0 overflow-y-auto': mode === 'split' }">
          <ForumMarkdown v-if="content.trim()" :content="content" />
          <p v-else class="text-sm text-$tx-text-color-secondary">
            还没有内容。
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
