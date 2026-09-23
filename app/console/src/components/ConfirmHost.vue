<script setup lang="ts">
import { TxModal } from "@talex-touch/tuffex/modal";
import { TxButton } from "@talex-touch/tuffex/button";
import { confirmState, settleConfirm } from "../lib/confirm";

/** 全局唯一的确认框。初始焦点在「取消」，关闭（遮罩、Esc、关闭按钮）一律视为取消。 */
function onVisible(value: boolean) {
  if (!value && confirmState.open) settleConfirm(false);
}
</script>

<template>
  <TxModal :model-value="confirmState.open" :title="confirmState.options.title" width="min(92vw, 440px)" @update:model-value="onVisible">
    <p v-if="confirmState.options.body" class="confirm-body">{{ confirmState.options.body }}</p>
    <template #footer>
      <div class="confirm-actions">
        <TxButton variant="secondary" autofocus @click="settleConfirm(false)">取消</TxButton>
        <TxButton :variant="confirmState.options.danger ? 'danger' : 'primary'" @click="settleConfirm(true)">
          {{ confirmState.options.confirmText ?? "确定" }}
        </TxButton>
      </div>
    </template>
  </TxModal>
</template>

<style scoped>
.confirm-body {
  margin: 0;
  line-height: 22px;
  color: var(--tx-text-color-regular);
  white-space: pre-line;
}
.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
