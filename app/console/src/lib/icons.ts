// 运行时才知道的图标：称号图标与部门可选图标由 /api/console/* 下发（Carbon 图标名，不带前缀）。
// 列表与服务端 app/server/src/lib/roles.ts 的 TITLES / DEPARTMENT_ICONS 一致，tests/console 会核对。

export const TITLE_ICONS = ["star-filled", "badge", "code", "compass", "user"] as const;

export const DEPARTMENT_ICONS = [
  "star-filled", "badge", "code", "compass", "user", "user-follow", "terminal", "forum", "application",
  "bullhorn", "education", "idea", "trophy", "user-favorite", "chart-network", "logo-github", "book",
] as const;

/** Carbon 图标名 → UnoCSS 类名；未知或空值回落到通用人物图标。 */
export function carbon(name: string | null | undefined): string {
  return `i-carbon-${name && /^[a-z0-9-]+$/.test(name) ? name : "user"}`;
}

export const RUNTIME_ICON_CLASSES = [...new Set([...TITLE_ICONS, ...DEPARTMENT_ICONS])].map(carbon);
