<script setup lang="ts">
// Catch-all: an unmatched URL becomes a proper 404 through Nuxt's error
// boundary (rendered by `error.vue`) instead of vue-router's "no match" warning.
// h3 wants the human text in `message`; `statusMessage` is a plain HTTP phrase.
throw createError({ statusCode: 404, statusMessage: 'Not Found', message: '你要找的内容可能已被删除，或者链接输错了。', fatal: true })
</script>

<template>
  <div />
</template>
