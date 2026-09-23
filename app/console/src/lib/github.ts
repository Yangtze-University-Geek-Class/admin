// GitHub 组织页面共用：接口前缀与「能否写」。组织固定为 /api/console/me 返回的 org（服务端 CONSOLE_ORG）；
// 接口仍是 /api/admin/:org/*，写操作由服务端按调用者自己的 GitHub 组织角色裁决。
import { computed } from "vue";
import { useSession } from "./session";

export function useOrg() {
  const { me, can } = useSession();
  const org = computed(() => me.value?.org ?? "");
  const apiBase = computed(() => `/api/admin/${encodeURIComponent(org.value)}`);
  return { org, apiBase, can, base: "/console/github" };
}

export const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;
