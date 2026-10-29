import { Component, type ReactNode } from "react";

/**
 * 窗口正文加载失败（断网、发版后旧页面找不到新文件名、CDN 超时）时只在这个窗口里说明，不让整个官网卸掉变成白屏。
 * React.lazy 和浏览器都会记住这次失败，所以这里只能刷新页面重来，文案就这么写。
 */
export default class WindowLoadFailed extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="pt-empty">
        <p>信纸没能打开。</p>
        <p>刷新页面再试一次。</p>
        <button type="button" className="pt-btn" onClick={() => window.location.reload()}>
          刷新页面
        </button>
      </div>
    );
  }
}
