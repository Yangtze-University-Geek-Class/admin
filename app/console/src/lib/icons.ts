// 运行时才知道的图标：称号与部门的图标由 /api/console/* 下发（Carbon 图标名，不带前缀），而且可以在控制台里改。
// 服务端只接受 app/server/src/lib/roles.ts 的 DEPARTMENT_ICONS 里的图标（称号也一样），这里原样列出供 UnoCSS 预生成，tests/console 会核对。

export const DEPARTMENT_ICONS = [
  "star-filled", "badge", "code", "compass", "user", "user-follow", "terminal", "forum", "application",
  "bullhorn", "education", "idea", "trophy", "user-favorite", "chart-network", "logo-github", "book", "user-admin",
] as const;

/** 图标的中文名：只给只显示图标的选择项做读屏标签和悬停提示；未知图标退回图标名。 */
const ICON_NAMES: Record<string, string> = {
  "star-filled": "星标", badge: "徽章", code: "代码", compass: "指南针", user: "人像", "user-follow": "添加成员",
  terminal: "终端", forum: "对话", application: "应用", bullhorn: "喇叭", education: "学位帽", idea: "灯泡",
  trophy: "奖杯", "user-favorite": "星标人像", "chart-network": "网络", "logo-github": "GitHub", book: "书", "user-admin": "带盾人像",
};
export const iconName = (name: string) => ICON_NAMES[name] ?? name;

/** Carbon 图标名 → UnoCSS 类名；未知或空值回落到通用人物图标。 */
export function carbon(name: string | null | undefined): string {
  return `i-carbon-${name && /^[a-z0-9-]+$/.test(name) ? name : "user"}`;
}

export const RUNTIME_ICON_CLASSES = DEPARTMENT_ICONS.map(carbon);
