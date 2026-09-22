<script setup lang="ts">
import type { NuxtError } from '#app'

// Rendered by Nuxt in place of the page tree; the layout is re-mounted here
// so the shell (header, sidebar) stays around the message.
const props = defineProps<{ error: NuxtError }>()

const is404 = computed(() => props.error.statusCode === 404)
const title = computed(() => (is404.value ? '哎呀，这个页面不存在' : '出了点问题'))
const description = computed(() => {
  // Nuxt's own cold-load 404 carries an English "Page Not Found: /path" message.
  const message = props.error.message
  if (is404.value)
    return message && !/^Page not found/i.test(message) ? message : '你要找的内容可能已被删除，或者链接输错了。'
  return message || '页面在渲染时遇到了错误。'
})

// Nuxt renders `error.vue` in place of `app.vue`, so the site-name template
// declared there never applies here; without this the 404 tab loses it.
const { siteName } = useContentSource()
useHead({ title, titleTemplate: value => (value ? `${value} · ${siteName}` : siteName) })

function goHome() {
  void clearError({ redirect: '/' })
}
</script>

<template>
  <NuxtLayout>
    <TxCard>
      <TxEmptyState
        :variant="is404 ? 'no-data' : 'error'"
        :title="title"
        :description="description"
        size="large"
        :primary-action="{ label: '返回首页', variant: 'primary', icon: 'i-carbon-home' }"
        @primary="goHome"
      />
    </TxCard>
  </NuxtLayout>
</template>
