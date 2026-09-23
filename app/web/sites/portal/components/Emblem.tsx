// 极客班校徽的几何抽象：外环 + 六片花瓣 + 六边形核心。
// 加载动画（花瓣随真实进度逐片点亮）、开机画面（花瓣飞入拼合）和桌面水印共用这一份图形。
type Props = {
  variant: "loader" | "boot" | "mark";
  /** 仅 loader：已点亮的花瓣数（0–6） */
  lit?: number;
  className?: string;
};

const PETALS = [0, 1, 2, 3, 4, 5];

export default function Emblem({ variant, lit = 0, className }: Props) {
  if (variant === "loader") {
    return (
      <svg className={className} viewBox="-100 -100 200 200" aria-hidden="true">
        <circle className="ld-ring" r="82" />
        <circle className="ld-ring-in" r="70" />
        {PETALS.map((i) => (
          <g key={i} transform={`rotate(${i * 60})`}>
            <polygon className={i < lit ? "ld-petal is-on" : "ld-petal"} points="-17,-60 17,-60 11,-28 -11,-28" />
          </g>
        ))}
        <polygon className="ld-core" points="0,-13 11.3,-6.5 11.3,6.5 0,13 -11.3,6.5 -11.3,-6.5" />
      </svg>
    );
  }
  if (variant === "boot") {
    return (
      <svg className={className} viewBox="-100 -100 200 200" aria-hidden="true">
        <circle className="bt-ring" r="78" fill="none" stroke="currentColor" strokeWidth="7" />
        <circle className="bt-ring" r="64" fill="none" stroke="currentColor" strokeWidth="1.5" opacity=".35" />
        {PETALS.map((i) => (
          <g key={i} transform={`rotate(${i * 60})`}>
            <polygon
              className="bt-petal"
              fill="currentColor"
              points="-15,-54 15,-54 10,-26 -10,-26"
              style={{ ["--r" as string]: `${i % 2 ? 50 : -50}deg`, animationDelay: `${0.25 + i * 0.07}s` }}
            />
          </g>
        ))}
        <polygon className="bt-core" fill="currentColor" points="0,-15 13,-7.5 13,7.5 0,15 -13,7.5 -13,-7.5" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="-100 -100 200 200" aria-hidden="true" fill="none" stroke="currentColor">
      <circle r="84" strokeWidth="5" />
      <circle r="70" strokeWidth="1.2" strokeDasharray="3 6" />
      {PETALS.map((i) => (
        <g key={i} transform={`rotate(${i * 60})`}>
          <polygon points="-15,-56 15,-56 10,-27 -10,-27" strokeWidth="2.4" />
        </g>
      ))}
      <polygon points="0,-14 12.1,-7 12.1,7 0,14 -12.1,7 -12.1,-7" strokeWidth="2.4" />
    </svg>
  );
}
