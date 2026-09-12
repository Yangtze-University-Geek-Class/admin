// Portal home. Static sample content (directions/articles/threads) until real
// APIs are wired in. Structure: hero -> directions -> sharing -> community signal.
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { appConfig, runtimeFeatures } from "@shared/config";
import Mascot, { mascotImage, type MascotPose } from "@shared/ui/Mascot";
import PortalHeader from "../components/PortalHeader";
import { externalUrl } from "@shared/lib/site";
import "../styles.css";

const DIRECTIONS: Array<{
  id: string;
  title: string;
  english: string;
  desc: string;
  detail: string;
  pose: MascotPose;
  tone: string;
}> = [
  { id: "cpp", title: "系统与算法", english: "C++ / SYSTEMS", desc: "从底层原理到工程实现", detail: "算法 · 编译原理 · 系统开发", pose: "coding", tone: "blue" },
  { id: "ai", title: "人工智能", english: "AI NATIVE", desc: "把模型接进真实工作流", detail: "LLM · Agent · MCP · RAG", pose: "ai", tone: "purple" },
  { id: "security", title: "信息安全", english: "SECURITY", desc: "理解攻击面，构建可信系统", detail: "Web 安全 · CTF · 安全研究", pose: "security", tone: "green" },
  { id: "more", title: "开放方向", english: "BUILD MORE", desc: "移动端、硬件与产品实验", detail: "开源 · 创意 · 跨方向协作", pose: "intro", tone: "amber" },
];

const ARTICLES = [
  { no: "01", tag: "AI CODING", title: "把 Agent 接进日常开发之后，我们改变了什么", summary: "从一次性提示词转向可复用的上下文、工具和协作规则。", meta: "实践笔记 · 8 min" },
  { no: "02", tag: "SYSTEMS", title: "从零搭建一个可读的 Git 工作流", summary: "让新人能理解、让维护者能回滚、让自动化工具能安全接手。", meta: "工程基础 · 6 min" },
  { no: "03", tag: "COMMUNITY", title: "技术社区如何避免只剩下链接转发", summary: "用项目、复盘和持续维护，把讨论变成共同资产。", meta: "组织建设 · 5 min" },
];

const THREADS = [
  { pose: "question" as MascotPose, tag: "问答", title: "第一次写 MCP Server，工具边界该怎么划分？", author: "newcomer", stats: "12 回复 · 2h" },
  { pose: "resource" as MascotPose, tag: "资源", title: "本学期系统方向学习路线与实验清单", author: "byte-wave", stats: "36 收藏 · 5h" },
  { pose: "ai" as MascotPose, tag: "分享", title: "小模型本地推理的显存与速度实测", author: "tensor-cat", stats: "24 回复 · 昨天" },
];

export default function Landing() {
  const features = runtimeFeatures();
  const palette = appConfig.portal.palette;
  const paletteStyle = {
    "--portal-bg": palette.bg,
    "--portal-panel": palette.panel,
    "--portal-panel-strong": palette.panelStrong,
    "--portal-line": palette.line,
    "--portal-accent": palette.accent,
    "--portal-accent-soft": palette.accentSoft,
    "--portal-text": palette.text,
    "--portal-muted": palette.muted,
    "--portal-warm": palette.warm,
  } as CSSProperties;

  return (
    <div className="portal-prototype" style={paletteStyle}>
      <div className="portal-grid" />
      {features.portalMotionEffects && <PortalAtmosphere />}
      <PortalHeader />

      <main>
        <section className="portal-hero portal-container">
          <div className="portal-hero-copy">
            <div className="portal-eyebrow"><span /> {appConfig.portal.hero.eyebrow}</div>
            <h1>
              {appConfig.portal.hero.titleLead}<br />
              <span>{appConfig.portal.hero.titleAccent}</span>
            </h1>
            <p>
              长江大学极客班是面向在校学生的技术共建社区。我们围绕系统、人工智能、信息安全与开源协作，
              用真实项目连接学习、表达和创造。
            </p>
            <div className="portal-hero-actions">
              <a href="#directions" className="portal-button portal-button-primary">探索方向 <span>↗</span></a>
              <a href={externalUrl("forum", "/")} className="portal-button portal-button-ghost">进入论坛 <span>→</span></a>
            </div>
            <div className="portal-hero-proof">
              <span><b>04</b> 技术方向</span>
              <span><b>OPEN</b> 开源协作</span>
              <span><b>AI</b> 原生工作流</span>
            </div>
          </div>
          <div className="portal-hero-visual">
            <div className="portal-visual-label">GEEK CLASS / 01</div>
            <div className="portal-visual-ring portal-visual-ring-one" />
            <div className="portal-visual-ring portal-visual-ring-two" />
            <div className="portal-visual-card">
              <img src={mascotImage("welcome")} alt="极客娘向你打招呼" />
            </div>
            <div className="portal-hero-bubble">
              <span>HELLO, BUILDER</span>
              今天想创造什么？
            </div>
            <div className="portal-coordinate">30.36° N / 112.15° E</div>
          </div>
        </section>

        <section id="directions" className="portal-section portal-container">
          <SectionHeading index="01" eyebrow="DIRECTIONS" title="从感兴趣的方向开始" desc="不要求先成为专家。带着问题进入项目，在协作和复盘里建立自己的技术坐标。" />
          <div className="portal-direction-grid">
            {DIRECTIONS.map((direction) => (
              <a key={direction.id} href={externalUrl("forum", "/")} className={`portal-direction-card tone-${direction.tone}`}>
                <div className="portal-direction-top">
                  <span>{direction.english}</span><i>↗</i>
                </div>
                <div className={`portal-direction-figure portal-direction-${direction.pose}`}><img src={mascotImage(direction.pose)} alt="" /></div>
                <h3>{direction.title}</h3>
                <p>{direction.desc}</p>
                <small>{direction.detail}</small>
              </a>
            ))}
          </div>
        </section>

        <section id="sharing" className="portal-section portal-container portal-split-section">
          <div>
            <SectionHeading index="02" eyebrow="FIELD NOTES" title="技术分享与项目复盘" desc="先放静态样板，不读取任何 API。内容结构会保留给后续博客和仓库动态接入。" />
            <div className="portal-article-list">
              {ARTICLES.map((article) => (
                <article key={article.no} className="portal-article-card">
                  <span className="portal-article-no">{article.no}</span>
                  <div>
                    <small>{article.tag}</small>
                    <h3>{article.title}</h3>
                    <p>{article.summary}</p>
                  </div>
                  <span className="portal-article-meta">{article.meta}</span>
                </article>
              ))}
            </div>
          </div>
          <aside className="portal-terminal-card">
            <div className="portal-terminal-bar"><span /><span /><span /><b>yugc://manifesto</b></div>
            <pre><code>{`$ whoami\nstudent / builder / maintainer\n\n$ cat principles.txt\n01  AI Native, not AI decoration\n02  Projects before slides\n03  Open source by default\n04  Seniors help newcomers\n\n$ status\nready to build_`}</code></pre>
            <img src={mascotImage("coding")} alt="极客娘正在编码" />
          </aside>
        </section>

        <section className="portal-section portal-container">
          <SectionHeading index="03" eyebrow="COMMUNITY SIGNAL" title="论坛正在讨论" desc="静态看板用于确认信息密度与看板娘在社区内容中的占比。" />
          <div className="portal-thread-list">
            {THREADS.map((thread) => (
              <a key={thread.title} href={externalUrl("forum", "/")} className="portal-thread-row">
                <span className="portal-thread-avatar"><img src={mascotImage(thread.pose)} alt="" /></span>
                <span className="portal-thread-tag">{thread.tag}</span>
                <strong>{thread.title}</strong>
                <span className="portal-thread-author">@{thread.author}</span>
                <span className="portal-thread-stats">{thread.stats}</span>
                <i>→</i>
              </a>
            ))}
          </div>
        </section>

        {features.mascotPreview && <section className="portal-section portal-container portal-mascot-lab">
          <div className="portal-mascot-copy">
            <div className="portal-eyebrow"><span /> MASCOT MODULE · PROTOTYPE</div>
            <h2>极客娘，不只是装饰。</h2>
            <p>模块已支持 8 套姿势、随机对话和页面场景映射。主站与论坛统一为右下角同尺寸展示。此板块仅开发环境可见，生产环境不展示；如需调整，修改 <code>web/shared/config/app.config.json</code> 中 <code>features.production.mascotPreview</code>。</p>
          </div>
          <Mascot preview pose="intro" />
        </section>}
      </main>

      <footer className="portal-footer">
        <div className="portal-container portal-footer-inner">
          <div>
            <strong>YUGC</strong>
            <span>长江大学极客班 · Build in public, grow together.</span>
          </div>
          <div className="portal-footer-links">
            <a href={appConfig.urls.githubOrg} target="_blank" rel="noreferrer">GitHub</a>
            <a href={externalUrl("forum", "/")}>论坛</a>
            <Link to="/docs">文档</Link>
            <a href={externalUrl("admin", "/admin")}>管理后台</a>
          </div>
        </div>
      </footer>

      {features.mascot && <Mascot pose="welcome" />}
    </div>
  );
}

function PortalAtmosphere() {
  const snippets = appConfig.portal.effects.codeSnippets;
  const symbols = Array.from({ length: appConfig.portal.effects.symbolCount }, (_, index) => index);
  return (
    <div className="portal-atmosphere" aria-hidden="true">
      <div className="portal-code-stream">
        {snippets.map((snippet, index) => (
          <code key={snippet} style={{ "--code-index": index } as CSSProperties}>{snippet}</code>
        ))}
      </div>
      <div className="portal-anime-symbols">
        {symbols.map((index) => <i key={index} style={{ "--symbol-index": index } as CSSProperties} />)}
      </div>
      <div className="portal-hex portal-hex-one" />
      <div className="portal-hex portal-hex-two" />
    </div>
  );
}

function SectionHeading({ index, eyebrow, title, desc }: { index: string; eyebrow: string; title: string; desc: string }) {
  return (
    <div className="portal-section-heading">
      <div><span>{index}</span><small>{eyebrow}</small></div>
      <h2>{title}</h2>
      <p>{desc}</p>
    </div>
  );
}
