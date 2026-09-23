import { onScopeDispose, ref, shallowRef, watch, type Ref, type WatchSource } from "vue";

export type Resource<T> = {
  data: Ref<T | undefined>;
  error: Ref<unknown>;
  loading: Ref<boolean>;
  reload: () => Promise<void>;
};

/**
 * 一次接口读取的状态：加载中、失败、数据。`deps` 变化时重新读取，旧请求的结果丢弃（按序号比对）。
 * 刷新时保留旧数据，避免列表闪空。
 */
export function useResource<T>(fetcher: () => Promise<T>, deps: WatchSource[] = [], options: { enabled?: () => boolean } = {}): Resource<T> {
  const data = shallowRef<T>();
  const error = shallowRef<unknown>(null);
  const loading = ref(false);
  let seq = 0;
  let disposed = false;

  async function reload() {
    if (options.enabled && !options.enabled()) return;
    const mine = ++seq;
    loading.value = true;
    error.value = null;
    try {
      const result = await fetcher();
      if (mine === seq && !disposed) data.value = result;
    } catch (err) {
      if (mine === seq && !disposed) error.value = err;
    } finally {
      if (mine === seq && !disposed) loading.value = false;
    }
  }

  watch(deps, () => void reload(), { immediate: true });
  onScopeDispose(() => { disposed = true; });
  return { data, error, loading, reload };
}

/** 一次写操作的状态：进行中与错误；成功返回结果，失败返回 undefined 并记下错误。 */
export function useAction<A extends unknown[], R>(run: (...args: A) => Promise<R>) {
  const pending = ref(false);
  const error = shallowRef<unknown>(null);
  async function execute(...args: A): Promise<R | undefined> {
    pending.value = true;
    error.value = null;
    try {
      return await run(...args);
    } catch (err) {
      error.value = err;
      return undefined;
    } finally {
      pending.value = false;
    }
  }
  return { pending, error, execute, reset: () => { error.value = null; } };
}
