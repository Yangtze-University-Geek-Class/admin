import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Home from "./pages/Home";

// 3D 场景页与普通页面按路由分包：首页之外的页面只在访问时下载。three.js 本身在各场景的 import() 里再次延迟。
const JoinUs = lazy(() => import("./pages/JoinUs"));
const Forum3D = lazy(() => import("./pages/Forum3D"));
const GithubScene = lazy(() => import("./pages/GithubScene"));
const Docs = lazy(() => import("./pages/Docs"));
const Feedback = lazy(() => import("./pages/Feedback"));
const JoinByToken = lazy(() => import("./pages/JoinByToken"));

/**
 * 官网路由。全部匿名可访问，无登录态概念。
 *   /            加载动画 + 3D 书桌 + YUGC OS 桌面
 *   /join-us     加入我们（信封场景，真实提交 POST /api/portal/apply）；旧地址 /apply 重定向到这里
 *   /forum-3d    论坛版块气泡场景（主入口「进入论坛首页」）
 *   /github      GitHub 组织贡献天际线（高度为示意）
 *   /docs /docs/:id /feedback /feedback/:org /join/:token
 */
export default function App() {
  return (
    <Suspense fallback={<div className="pt-route-fallback" aria-busy="true" />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/join-us" element={<JoinUs />} />
        <Route path="/apply" element={<Navigate to="/join-us" replace />} />
        <Route path="/forum-3d" element={<Forum3D />} />
        <Route path="/github" element={<GithubScene />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="/docs/:id" element={<Docs />} />
        <Route path="/feedback" element={<Feedback />} />
        <Route path="/feedback/:org" element={<Feedback />} />
        <Route path="/join/:token" element={<JoinByToken />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
