// 论坛 3D 场景：五个版块气泡围成一圈（../three/forum.ts），左侧是等价的 DOM 列表（键盘、读屏、窄屏兜底）。
// 主入口「进入论坛首页」一直在；版块链接指向论坛的 /c/<slug>。
import { useCallback, useEffect, useRef, useState } from "react";
import { appConfig } from "@shared/config";
import Icon from "../components/Icon";
import SceneBar from "../components/SceneBar";
import { measureBand } from "../lib/cameraMath";
import { links } from "../lib/links";
import { useReducedMotion } from "../lib/useReducedMotion";
import type { ForumBoard, ForumHandle } from "../three/forum";
import "../styles/portal.css";
import "../styles/scenes.css";

// 版块名称与说明取自论坛的 app/forum/content/curation.json
export const FORUM_BOARDS: readonly ForumBoard[] = [
  { slug: "announcements", name: "班级公告", desc: "通知、活动安排和规则", color: "#e5484d", icon: "megaphone-line" },
  { slug: "courses", name: "课程与作业", desc: "作业讨论、考试和选课", color: "#2f6fed", icon: "book-open-line" },
  { slug: "competitions", name: "竞赛与项目", desc: "比赛信息、组队和项目进展", color: "#e39410", icon: "trophy-line" },
  { slug: "careers", name: "求职与升学", desc: "实习、校招、考研和出国", color: "#0e8fc9", icon: "briefcase-line" },
  { slug: "ai", name: "人工智能", desc: "大模型、Agent 和 AI Coding", color: "#5b5fd6", icon: "brain-line" },
];

export default function Forum3D() {
  const reducedMotion = useReducedMotion();
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<ForumHandle | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  const wipe = useRef<HTMLDivElement>(null);
  const intro = useRef<HTMLElement>(null);
  const boardsNav = useRef<HTMLElement>(null);
  const [hot, setHot] = useState(-1);

  const go = useCallback((index: number) => {
    window.location.assign(index < 0 ? links.forumHome() : links.forumCategory(FORUM_BOARDS[index].slug));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const module = await import("../three/forum");
        if (cancelled || !canvas.current) return;
        const handle = await module.createForumScene(canvas.current, {
          reducedMotion,
          logoUrl: appConfig.portal.brand.logo,
          boards: FORUM_BOARDS,
          band: () => measureBand(intro.current?.querySelector(":scope > .pt-btn") ?? null, boardsNav.current),
          onHot: setHot,
          onTip: (text, x, y) => {
            const el = tip.current;
            if (!el) return;
            el.textContent = text;
            el.classList.toggle("is-on", Boolean(text));
            if (text) el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -150%)`;
          },
          onWipe: (value) => wipe.current?.style.setProperty("opacity", String(value)),
          onOpen: go,
        });
        if (cancelled) handle.dispose();
        else scene.current = handle;
      } catch {
        /* 没有 WebGL：左侧列表照常可用 */
      }
    })();
    // 从论坛按浏览器后退回来时，浏览器可能整页从往返缓存（bfcache）恢复，转场停在最后一帧：
    // 镜头推近、气泡放大、遮罩盖满，场景也不再响应拖动和点击。整个场景复位，没有场景时只撤遮罩
    const onShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      wipe.current?.style.setProperty("opacity", "0");
      scene.current?.reset();
    };
    window.addEventListener("pageshow", onShow);
    return () => {
      cancelled = true;
      window.removeEventListener("pageshow", onShow);
      scene.current?.dispose();
      scene.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在挂载时建一次场景
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest("input, textarea")) return;
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        const step = event.key === "ArrowRight" ? 1 : FORUM_BOARDS.length - 1;
        scene.current?.focusBoard((Math.max(hot, 0) + step) % FORUM_BOARDS.length);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hot]);

  return (
    <div className="pt-root pt-scene pt-forum3d">
      <canvas ref={canvas} className="pt-scene-canvas is-grab" aria-hidden="true" />
      <SceneBar />
      <section ref={intro} className="pt-intro pt-forum-intro" aria-labelledby="pt-forum-title">
        <h1 id="pt-forum-title">论坛</h1>
        <p>极客班的讨论区，公告、课程、竞赛、求职都在这里。选一个版块进去，或者直接进论坛首页。</p>
        <a
          className="pt-btn is-primary is-lg"
          href={links.forumHome()}
          onClick={(event) => {
            if (!scene.current) return;
            event.preventDefault();
            scene.current.goHome();
          }}
        >
          <Icon name="discuss-line" size={18} /> 进入论坛首页
        </a>
        <nav ref={boardsNav} className="pt-boards" aria-label="论坛版块">
          {FORUM_BOARDS.map((board, index) => (
            <a
              key={board.slug}
              href={links.forumCategory(board.slug)}
              className={index === hot ? "is-hot" : undefined}
              onFocus={() => scene.current?.focusBoard(index)}
              onMouseEnter={() => scene.current?.focusBoard(index)}
              onClick={(event) => {
                if (!scene.current) return;
                event.preventDefault();
                scene.current.open(index);
              }}
            >
              <span className="pt-board-ico" style={{ color: board.color, background: `${board.color}1a` }}>
                <Icon name={board.icon} size={16} />
              </span>
              <span className="pt-board-name">{board.name}</span>
              <small>{board.desc}</small>
            </a>
          ))}
        </nav>
      </section>
      <div className="pt-tip" ref={tip} aria-hidden="true" />
      <p className="pt-scene-note" aria-hidden="true">
        拖动或按方向键转动，点气泡进版块，点中间的校徽进论坛首页
      </p>
      <div className="pt-wipe" ref={wipe} aria-hidden="true" />
    </div>
  );
}
