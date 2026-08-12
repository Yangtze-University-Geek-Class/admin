import { useEffect, useMemo, useState } from "react";

export type MascotPose =
  | "welcome"
  | "coding"
  | "ai"
  | "security"
  | "question"
  | "resource"
  | "intro"
  | "sleep";

export type MascotMode = "public" | "community";

const POSE_FILES: Record<MascotPose, string> = {
  welcome: "/mascot/pose-01-welcome.webp",
  coding: "/mascot/pose-02-coding.webp",
  ai: "/mascot/pose-03-ai.webp",
  security: "/mascot/pose-04-security.webp",
  question: "/mascot/pose-05-question.webp",
  resource: "/mascot/pose-06-resource.webp",
  intro: "/mascot/pose-07-intro.webp",
  sleep: "/mascot/pose-08-sleep.webp",
};

const POSE_LABELS: Record<MascotPose, string> = {
  welcome: "欢迎",
  coding: "编码",
  ai: "AI",
  security: "信安",
  question: "提问",
  resource: "资源",
  intro: "介绍",
  sleep: "休息",
};

const DIALOGS: Record<MascotPose, string[]> = {
  welcome: ["欢迎来到长江大学极客班。", "今天想探索什么技术？", "从一个真实项目开始吧。"],
  coding: ["代码先跑起来，再把问题拆小。", "编译器没有情绪，报错都是线索。"],
  ai: ["Agent、MCP、上下文工程，这里都有人聊。", "让 AI 成为工作流，而不只是聊天框。"],
  security: ["先确认边界，再开始测试。", "安全不是功能上线后的补丁。"],
  question: ["问题描述越清楚，答案来得越快。", "贴上复现步骤和报错信息吧。"],
  resource: ["好资料要分享，也要写清适用范围。", "这里收集课程、论文与开源项目。"],
  intro: ["我们用项目连接同学、技术与开源。", "想认识极客班？从方向组开始。"],
  sleep: ["页面走丢了，先休息一下。", "这里暂时没有内容。"],
};

export function mascotImage(pose: MascotPose): string {
  return POSE_FILES[pose];
}

export function mascotLabel(pose: MascotPose): string {
  return POSE_LABELS[pose];
}

type Props = {
  mode?: MascotMode;
  pose?: MascotPose;
  dialogs?: string[];
  className?: string;
  preview?: boolean;
  onModeChange?: (mode: MascotMode) => void;
};

export default function Mascot({
  mode = "public",
  pose = "welcome",
  dialogs,
  className = "",
  preview = false,
  onModeChange,
}: Props) {
  const [open, setOpen] = useState(mode === "community");
  const [dialogIndex, setDialogIndex] = useState(0);
  const [currentPose, setCurrentPose] = useState<MascotPose>(pose);
  const dialogList = useMemo(() => dialogs?.length ? dialogs : DIALOGS[currentPose], [dialogs, currentPose]);

  useEffect(() => {
    setCurrentPose(pose);
    setDialogIndex(0);
  }, [pose]);

  useEffect(() => {
    setOpen(mode === "community");
  }, [mode]);

  const nextDialog = () => {
    setOpen(true);
    setDialogIndex((current) => (current + 1) % dialogList.length);
  };

  if (preview) {
    return (
      <div className={`mascot-preview ${className}`}>
        <div className="mascot-preview-stage" aria-live="polite">
          <div className="mascot-dialog mascot-dialog-preview">
            <span className="mascot-dialog-kicker">YUGC ASSISTANT</span>
            {dialogList[dialogIndex]}
          </div>
          <button type="button" className="mascot-preview-character" onClick={nextDialog} aria-label="和极客娘对话">
            <span className="mascot-orbit mascot-orbit-one" />
            <span className="mascot-orbit mascot-orbit-two" />
            <img src={POSE_FILES[currentPose]} alt={`极客娘${POSE_LABELS[currentPose]}姿势`} />
          </button>
        </div>
        <div className="mascot-preview-controls" aria-label="看板娘姿势选择">
          {(Object.keys(POSE_FILES) as MascotPose[]).map((item) => (
            <button
              type="button"
              key={item}
              onClick={() => { setCurrentPose(item); setDialogIndex(0); }}
              className={item === currentPose ? "is-active" : ""}
            >
              {POSE_LABELS[item]}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`mascot-shell mascot-${mode} ${open ? "is-open" : ""} ${className}`}>
      <div className="mascot-dialog" role="status">
        <span className="mascot-dialog-kicker">极客娘</span>
        {dialogList[dialogIndex]}
        {onModeChange && (
          <button
            type="button"
            className="mascot-dialog-action"
            onClick={() => onModeChange(mode === "public" ? "community" : "public")}
          >
            切换到{mode === "public" ? "社区" : "对外"}展示
          </button>
        )}
      </div>
      <button
        type="button"
        className="mascot-character"
        onClick={nextDialog}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => mode === "public" && setOpen(false)}
        aria-label="和极客娘对话"
      >
        <span className="mascot-status-dot" />
        <img src={POSE_FILES[currentPose]} alt={`极客娘${POSE_LABELS[currentPose]}姿势`} />
      </button>
    </div>
  );
}
