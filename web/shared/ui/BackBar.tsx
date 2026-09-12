import { Link, useNavigate } from "react-router-dom";

type Props = {
  /** Fallback path when there's no browser history to go back to */
  fallback?: string;
  /** Optional label shown after the arrow, e.g. "返回论坛" */
  label?: string;
  className?: string;
};

export default function BackBar({ fallback = "/", label = "返回", className = "" }: Props) {
  const nav = useNavigate();
  const onClick = () => {
    if (window.history.length > 1) nav(-1);
    else nav(fallback);
  };
  return (
    <div className={`flex items-center gap-3 mb-3 ${className}`}>
      <button onClick={onClick} className="inline-flex items-center gap-1.5 text-sm text-ink-300 hover:text-brand-500 transition">
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M12.79 5.23a.75.75 0 010 1.06L9.06 10l3.73 3.71a.75.75 0 11-1.06 1.06l-4.25-4.25a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 0z" clipRule="evenodd" /></svg>
        {label}
      </button>
      <span className="text-ink-600">/</span>
      <Link to="/" className="text-sm text-ink-400 hover:text-brand-500 transition">论坛首页</Link>
    </div>
  );
}
