// 危险操作前的确认。全局只有一个确认框（components/ConfirmHost.vue），调用方 await 结果。
import { reactive } from "vue";

export type ConfirmOptions = { title: string; body?: string; confirmText?: string; danger?: boolean };

export const confirmState = reactive({
  open: false,
  options: { title: "" } as ConfirmOptions,
  resolve: null as ((ok: boolean) => void) | null,
});

export function confirm(options: ConfirmOptions): Promise<boolean> {
  // 上一个还没答复就被新的替换时，按「取消」结束它，不让调用方永远挂起。
  confirmState.resolve?.(false);
  return new Promise(resolve => {
    confirmState.options = options;
    confirmState.resolve = resolve;
    confirmState.open = true;
  });
}

export function settleConfirm(ok: boolean) {
  const resolve = confirmState.resolve;
  confirmState.resolve = null;
  confirmState.open = false;
  resolve?.(ok);
}
