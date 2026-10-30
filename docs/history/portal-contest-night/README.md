# 比赛窗口夜空头图退场内容（#278）

> #278 把主站比赛窗口的官网入口横幅和比赛详情头图从夜空改成和第一期比赛官网同一套浅色时退场的组件与样式，原样放在这里备查；它们不参与构建，也不会上线。

状态：`historical` · 更新：2026-10-24

## 为什么改

所有者 2026-10-24 16:38「[已脱敏]」、16:57「[已脱敏]」。第一期比赛官网改成了浅色，比赛窗口里的横幅是官网的入口、详情头图是官网首屏的缩小版，不能一深一浅，所以一起换成浅色。

## 为什么不会上线

- 镜像的构建上下文不含 `docs/`（仓库根的 `.dockerignore`），这里的文件进不了任何镜像。
- `app/web` 的 tsconfig 和 Vite 构建只读 `app/web` 里的代码，vitest 只跑 `tests/`，都不读这里。
- 公开文档接口不读 `docs/history/`（见 [历史材料](../README.md)）。
- 没有路由变化：横幅和头图都在比赛窗口里，换样子不换地址。

## 文件清单

`files/` 下面按原来的仓库路径存放，三个文件都和 stage `4c7c5dd5`（#278 变基的起点）里同一路径的文件逐字节相同，可以用 `git show 4c7c5dd5:<原路径>` 对照。路径里省略的前缀是 `app/web/sites/portal/`。

| 原路径 | 是什么 | 换成了什么 |
|---|---|---|
| `components/os/competitions/NightSky.tsx` | 按种子撒星星的夜空 SVG（亮的几颗慢慢呼吸），横幅和详情头图共用 | `components/os/competitions/ContestBackdrop.tsx`：默认导出 `ContestGlow`（暖白底上四团漂移的彩色柔光和流动的透视网格），`HeatMark`（贡献热力图拼出的「OSS CHALLENGE」静态字标，字形和官网共用 `app/web/shared/lib/heatmark.ts`） |
| `components/os/competitions/ContestSite.tsx` | 夜空横幅：YUGC 四色泡泡字母的「OSS CHALLENGE」、一行浅蓝小字、白色「打开官网」按钮 | 同一路径的新版：`ContestGlow` 背景、`HeatMark` 字标、渐变色的「极客班开源实战贡献挑战赛」、紫色墨线胶囊按钮 |
| `styles/competitions.css` | 整份原文件；退场的是 `.pt-cx-night`、`.pt-cx-stars`、`pt-cx-twinkle`、夜空下的 `.pt-cx-site*` 和 `.pt-cx-hero*`（深色遮罩、白色网格、白字、半透明白胶囊、白底主按钮） | 同一路径的新版：`.pt-cx-light`、`.pt-cg*`、`.pt-cx-grad`、`.pt-cx-heat` 和浅色的 `.pt-cx-site*`、`.pt-cx-hero*` |

`components/os/competitions/CompetitionHero.tsx` 只换了背景组件和比赛名的渐变字，没有归档。

第一期比赛官网本身的深色版（夜空 Canvas `src/sky.ts`、极客娘图 `public/geek-girl.webp`）只在 task 分支上存在过（`e9fb5a61` 加、`4ddf0a8f` 删），没有进过 stage，也没有上线，不在这里归档。

## 怎么看原来的样子

这些文件只是存档，不能直接放回 `app/` 运行。要看当时的效果，检出 `4c7c5dd5` 按那时的说明在本机启动，打开比赛窗口。
