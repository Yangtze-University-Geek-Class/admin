// YUGC OS 桌面上的东西：左上角一列应用图标（加入我们、论坛、GitHub 组织在最前面），
// 图标右边、壁纸天空里一张「新来的看这里」便签，按顺序说清怎么加入。壁纸是极客娘，桌面上不再铺组件卡片。
import type { IconName } from "../../lib/icons";
import { OS_APPS, type AppId, type OsApp } from "../../lib/osApps";
import Icon from "../Icon";

type OpenApp = (id: AppId | "forum-feed", from?: HTMLElement | null) => void;

export const DEPARTMENTS: ReadonlyArray<{ name: string; icon: IconName; does: string; tint: string }> = [
  // 部门与职责来自服务端 app/server/src/lib/roles.ts 的 DEFAULT_DEPARTMENTS
  { name: "招新部", icon: "user-add-line", does: "招新和面试", tint: "#3346c8" },
  { name: "技术部", icon: "code-s-slash-line", does: "仓库和基础设施", tint: "#5b5fd6" },
  { name: "社区部", icon: "discuss-line", does: "论坛和意见箱", tint: "#128a7e" },
  { name: "项目部", icon: "git-repository-line", does: "项目立项和展示", tint: "#a16207" },
];

/**
 * 桌面图标：单击选中、双击或回车打开（和电脑桌面一样）。触屏上单击就打开。
 * 三个主入口排在最前；它们是做什么的，由右边的「新来的看这里」便签和 Dock 上的名字说明。
 */
export function DesktopIcons({ selected, onSelect, onOpen }: { selected: AppId | null; onSelect: (id: AppId | null) => void; onOpen: OpenApp }) {
  const touch = typeof window !== "undefined" && window.matchMedia("(hover: none)").matches;
  return (
    <ul className="pt-icons" aria-label="桌面上的应用">
      {OS_APPS.map((app) => (
        <li key={app.id} className={app.key ? "is-main" : undefined}>
          <button
            type="button"
            data-cta={app.id}
            className={selected === app.id ? "pt-dti is-sel" : "pt-dti"}
            title={app.blurb}
            onClick={(event) => (touch ? onOpen(app.id, event.currentTarget) : onSelect(app.id))}
            onDoubleClick={(event) => onOpen(app.id, event.currentTarget)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen(app.id, event.currentTarget);
              }
            }}
          >
            <AppGlyph app={app} size={26} />
            <span className="pt-dti-name">{app.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function AppGlyph({ app, size = 24 }: { app: OsApp; size?: number }) {
  return (
    <span className="pt-glyph" style={{ ["--tint" as string]: app.tint }}>
      <Icon name={app.icon} size={size} />
      {app.lock && (
        <em>
          <Icon name="lock-line" size={10} />
        </em>
      )}
    </span>
  );
}

/**
 * 「新来的看这里」：像贴在桌面上的便签，说清怎么加入、另外两个应用是什么；每一行点下去就打开写着的那个应用。
 * 可以收起；收起后只在菜单栏「帮助」里重新打开，本次浏览不再自动出现。
 */
export function StartNote({ onOpen, onClose }: { onOpen: OpenApp; onClose: () => void }) {
  const steps: Array<{ id: AppId; title: string; text: string }> = [
    { id: "join", title: "在「加入我们」写封信", text: "写上姓名、班级、邮箱，再说说你会什么。招新部看完用邮件联系你。" },
    { id: "forum", title: "去「论坛」看看大家在聊什么", text: "公告、课程、竞赛和求职都在这里，不用登录也能看。" },
    { id: "github", title: "去「GitHub 组织」看我们的代码", text: "极客班的公开仓库都在这里。" },
  ];
  return (
    <aside className="pt-note" aria-labelledby="pt-note-title">
      <header>
        <h2 id="pt-note-title">新来的看这里</h2>
        <button type="button" className="pt-note-close" aria-label="收起这张便签" onClick={onClose}>
          <Icon name="close-line" size={14} />
        </button>
      </header>
      <p className="pt-note-lead">这是长江大学极客班的桌面。想加入就写封信；也可以先看看论坛和我们的代码。</p>
      <ol>
        {steps.map((step, index) => (
          <li key={step.id}>
            <button type="button" onClick={(event) => onOpen(step.id, event.currentTarget)}>
              <b>{index + 1}</b>
              <span>
                <strong>{step.title}</strong>
                <small>{step.text}</small>
              </span>
              <Icon name="arrow-right-s-line" size={16} />
            </button>
          </li>
        ))}
      </ol>
      <p className="pt-note-foot">双击桌面上的图标也能打开应用，按 ⌘K 可以搜索。</p>
    </aside>
  );
}
