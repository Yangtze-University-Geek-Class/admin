<script setup lang="ts">
import { TxAvatar } from "@talex-touch/tuffex/avatar";

/** 成员：头像 + 等宽 @登录名，可选一行说明。没有头像时 TxAvatar 用登录名首字母。 */
withDefaults(defineProps<{ login: string; src?: string | null; sub?: string; size?: number; link?: boolean }>(), { src: null, sub: "", size: 28, link: false });
</script>

<template>
  <span class="user-cell">
    <TxAvatar :src="src ?? undefined" :name="login" :alt="src ? `@${login} 的头像` : undefined" :size="size" />
    <span class="cell-stack">
      <a v-if="link" class="mono user-cell__login" :href="`https://github.com/${login}`" target="_blank" rel="noreferrer">@{{ login }}</a>
      <span v-else class="mono user-cell__login">@{{ login }}</span>
      <span v-if="sub" class="cell-sub ellipsis">{{ sub }}</span>
    </span>
  </span>
</template>

<style scoped>
.user-cell {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  max-width: 100%;
}
.user-cell__login {
  color: var(--tx-text-color-primary);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
a.user-cell__login:hover {
  color: var(--tx-color-primary);
  text-decoration: underline;
}
</style>
