// 当前登录者与能力清单。`can` 只决定显示什么；真正的授权在服务端。
import { computed, reactive } from "vue";
import { api } from "./http";
import type { BlockReason, Capability, Catalogue, ConsoleMe } from "./types";

const state = reactive({
  me: null as ConsoleMe | null,
  meError: null as unknown,
  meLoading: false,
  catalogue: null as Catalogue | null,
  /** 最近一次读 catalogue 失败（这时称号的名字退回默认值）。 */
  catalogueFailed: false,
});

async function fetchCatalogue(): Promise<Catalogue | null> {
  const next = await api<Catalogue>("/api/console/catalogue").catch(() => null);
  state.catalogueFailed = next === null;
  return next;
}

let pendingMe: Promise<void> | null = null;

export async function loadMe(force = false): Promise<void> {
  if (pendingMe && !force) return pendingMe;
  state.meLoading = true;
  pendingMe = (async () => {
    try {
      state.me = await api<ConsoleMe>("/api/console/me");
      state.meError = null;
      if (state.me.capabilities.includes("console.access") && !state.catalogue) {
        // 称号与能力的名字只是显示用；失败不挡页面，称号退回默认名字，能力退回显示 id。
        state.catalogue = await fetchCatalogue();
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

/** 称号改名、改权限后重新读 catalogue，让所有徽章和权限名跟着变。读失败时保留旧的。 */
export async function reloadCatalogue(): Promise<void> {
  if (!state.me?.capabilities.includes("console.access")) return;
  const next = await fetchCatalogue();
  if (next) state.catalogue = next;
}

export function clearSession() {
  state.me = null;
  state.meError = null;
  state.catalogue = null;
  state.catalogueFailed = false;
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
    catalogueFailed: computed(() => state.catalogueFailed),
    reload: () => loadMe(true),
    reloadCatalogue,
  };
}
