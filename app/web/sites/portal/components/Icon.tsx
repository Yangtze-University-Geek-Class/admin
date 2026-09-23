// 官网统一线性图标（Remix Icon，路径数据在 ../lib/icons.ts）。装饰用途默认对读屏隐藏；
// 需要朗读时传 label。禁止用 emoji 或装饰性 unicode 箭头代替图标。
import { ICONS, type IconName } from "../lib/icons";

type Props = { name: IconName; size?: number; className?: string; label?: string };

export default function Icon({ name, size = 18, className, label }: Props) {
  return (
    <svg
      className={className ? `pt-icon ${className}` : "pt-icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      focusable="false"
    >
      {ICONS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
