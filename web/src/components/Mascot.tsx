// Unified mascot module. One spec (size/position from app.config.json) used by
// portal and forum, fixed bottom-right. Chat text renders in a dedicated
// transparent panel above the feedback button (scrollable, decoupled from the character).
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { appConfig, type MascotPoseName } from "../config";

export type MascotPose = MascotPoseName;

const POSE_NAMES = Object.keys(appConfig.mascot.poses) as MascotPose[];

function poseStyle(pose: MascotPose): CSSProperties {
  const config = appConfig.mascot.poses[pose];
  return {
    objectFit: config.fit,
    objectPosition: config.position,
    transform: `scale(${config.scale})`,
  };
}

export function mascotImage(pose: MascotPose): string {
  return appConfig.mascot.poses[pose].file;
}

export function mascotLabel(pose: MascotPose): string {
  return appConfig.mascot.poses[pose].label;
}

type Props = {
  pose?: MascotPose;
  dialogs?: string[];
  className?: string;
  preview?: boolean;
};

export default function Mascot({
  pose = appConfig.mascot.defaultPose,
  dialogs,
  className = "",
  preview = false,
}: Props) {
  const [dialogIndex, setDialogIndex] = useState(0);
  const [currentPose, setCurrentPose] = useState<MascotPose>(pose);
  const dialogList = useMemo(
    () => dialogs?.length ? dialogs : appConfig.mascot.dialogs[currentPose],
    [dialogs, currentPose],
  );

  useEffect(() => {
    setCurrentPose(pose);
    setDialogIndex(0);
  }, [pose]);

  const nextDialog = () => {
    setDialogIndex((current) => (current + 1) % dialogList.length);
  };

  if (preview) {
    return (
      <div className={`mascot-preview mascot-pose-${currentPose} ${className}`}>
        <div className="mascot-preview-stage" aria-live="polite">
          <div className="mascot-dialog mascot-dialog-preview">
            <span className="mascot-dialog-kicker">YUGC ASSISTANT</span>
            {dialogList[dialogIndex]}
          </div>
          <button type="button" className="mascot-preview-character" onClick={nextDialog} aria-label="和极客娘对话">
            <span className="mascot-orbit mascot-orbit-one" />
            <span className="mascot-orbit mascot-orbit-two" />
            <img src={mascotImage(currentPose)} alt={`极客娘${mascotLabel(currentPose)}姿势`} style={poseStyle(currentPose)} />
          </button>
        </div>
        <div className="mascot-preview-controls" aria-label="看板娘姿势选择">
          {POSE_NAMES.map((item) => (
            <button
              type="button"
              key={item}
              onClick={() => { setCurrentPose(item); setDialogIndex(0); }}
              className={item === currentPose ? "is-active" : ""}
            >
              {mascotLabel(item)}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`mascot-shell mascot-pose-${currentPose} ${className}`}
      style={{
        "--mascot-width": `${appConfig.mascot.width}px`,
        "--mascot-height": `${appConfig.mascot.height}px`,
      } as CSSProperties}
    >
      <div className="mascot-bubble-panel" role="status">
        <div className="mascot-bubble">
          <span className="mascot-dialog-kicker">极客娘</span>
          {dialogList[dialogIndex]}
        </div>
      </div>
      <button
        type="button"
        className="mascot-character"
        onClick={nextDialog}
        aria-label="和极客娘对话"
      >
        <span className="mascot-status-dot" />
        <img src={mascotImage(currentPose)} alt={`极客娘${mascotLabel(currentPose)}姿势`} style={poseStyle(currentPose)} />
      </button>
    </div>
  );
}
