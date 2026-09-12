// 端的挂载路径解析。
//
// 拆分后每个端有独立入口（web/sites/<端>/main.tsx），入口已经知道自己是哪个端，
// 因此不再需要旧的 detectSite() 去猜。
import { appConfig, type AppSiteKind } from "../config";

/**
 * 该端在当前浏览器地址下的路由 basename。
 *
 * 三个端的配置 basename 都是空串，唯一例外是论坛：当它挂在官网域名下的
 * `/forum` 路径（而不是自己的子域）时，需要把 `/forum` 作为 basename，
 * 否则站内链接会全部少一层前缀。
 *
 * 子域启用后 `forum.yangtzeu.work` 命中的是配置值（空串），此特例自然失效。
 */
export function getBasePath(kind: AppSiteKind): string {
  const configured = appConfig.sites[kind].basePath;

  // 开发态每个端由 Vite 从 /sites/<端>/ 提供（见 vite.config.ts 的
  // devSiteFallback），路由前缀必须跟上，否则站内点击会跳到 /t/101
  // 这种脱离入口的路径。生产不使用这个分支。
  if (import.meta.env.DEV) return `/sites/${kind}`;

  if (typeof window === "undefined" || kind !== "forum") return configured;

  const onPortalHost = window.location.hostname === appConfig.sites.portal.host;
  const underForumPath = window.location.pathname.startsWith("/forum");
  return onPortalHost && underForumPath ? "/forum" : configured;
}
