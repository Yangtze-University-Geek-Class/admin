import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { appConfig, type MascotPoseName } from "../../config";

export type MascotPose = MascotPoseName;
export type MascotMode = "public" | "community";

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
  mode?: MascotMode;
  pose?: MascotPose;
  dialogs?: string[];
  className?: string;
  preview?: boolean;
  onModeChange?: (mode: MascotMode) => void;
};

export default function Mascot({
  mode = "public",
  pose = appConfig.mascot.defaultPose,
  dialogs,
  className = "",
  preview = false,
  onModeChange,
}: Props) {
  const [open, setOpen] = useState(mode === "community");
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

  useEffect(() => {
    setOpen(mode === "community");
  }, [mode]);

  const nextDialog = () => {
    setOpen(true);
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
      className={`mascot-shell mascot-${mode} mascot-pose-${currentPose} ${open ? "is-open" : ""} ${className}`}
      style={{
        "--mascot-public-width": `${appConfig.mascot.publicWidth}px`,
        "--mascot-public-height": `${appConfig.mascot.publicHeight}px`,
        "--mascot-community-width": `${appConfig.mascot.communityWidth}px`,
        "--mascot-community-height": `${appConfig.mascot.communityHeight}px`,
        "--mascot-dialog-gap": `${appConfig.mascot.dialogGap}px`,
      } as CSSProperties}
    >
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
        <img src={mascotImage(currentPose)} alt={`极客娘${mascotLabel(currentPose)}姿势`} style={poseStyle(currentPose)} />
      </button>
    </div>
  );
}
