// 当前登录者与能力清单。`can` 只决定显示什么；真正的授权在服务端。
import { computed, reactive } from "vue";
import { api } from "./http";
import type { BlockReason, Capability, Catalogue, ConsoleMe } from "./types";

const state = reactive({
  me: null as ConsoleMe | null,
  meError: null as unknown,
  meLoading: false,
  catalogue: null as Catalogue | null,
});

let pendingMe: Promise<void> | null = null;

export async function loadMe(force = false): Promise<void> {
  if (pendingMe && !force) return pendingMe;
  state.meLoading = true;
  pendingMe = (async () => {
    try {
      state.me = await api<ConsoleMe>("/api/console/me");
      state.meError = null;
      if (state.me.capabilities.includes("console.access") && !state.catalogue) {
        // 能力中文名只是显示用；失败不挡页面，退回显示能力 id。
        state.catalogue = await api<Catalogue>("/api/console/catalogue").catch(() => null);
      }
    } catch (error) {
      state.me = null;
      state.meError = error;
    } finally {
      state.meLoading = false;
      pendingMe = null;
    }
  })();
  return pendingMe;
}

export function clearSession() {
  state.me = null;
  state.meError = null;
  state.catalogue = null;
}

export function useSession() {
  const me = computed(() => state.me);
  const catalogue = computed(() => state.catalogue);
  const can = (capability: Capability) => Boolean(state.me?.capabilities.includes(capability));
  const canAny = (anyOf: Capability[]) => anyOf.some(can);
  const blocked = (capability: Capability): BlockReason | null => state.me?.blocked.find(item => item.capability === capability)?.reason ?? null;
  const capabilityLabel = (id: Capability) => state.catalogue?.capabilities.find(item => item.id === id)?.label ?? id;
  return {
    me, catalogue, can, canAny, blocked, capabilityLabel,
    meError: computed(() => state.meError),
    meLoading: computed(() => state.meLoading),
    reload: () => loadMe(true),
  };
}
