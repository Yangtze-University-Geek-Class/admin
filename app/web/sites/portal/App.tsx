import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
// 表单样式（pages.css）随入口一起加载，不作为「加入我们」「意见箱」窗口打开时才取的分包 CSS：分包 CSS 取失败时窗口整个打不开（#310）
import "./styles/pages.css";

// 3D 场景页与普通页面按路由分包：首页之外的页面只在访问时下载。three.js 本身在各场景的 import() 里再次延迟。
const Forum3D = lazy(() => import("./pages/Forum3D"));
const Docs = lazy(() => import("./pages/Docs"));

/**
 * 官网路由。全部匿名可访问；登录状态只用来显示资料卡、投递限额和比赛里的「我」。
 *   /            开机动画（每天第一次进来播）+ YUGC OS 桌面
 *   /join-us、/apply  跳到 /?open=join：进桌面打开「加入我们」窗口（#279；原来的信封场景页已归档）
 *   /forum-3d    论坛版块气泡场景（主入口「进入论坛首页」）。不是桌面入口的中间页（#185）：桌面上的「论坛」直达论坛首页，
 *                这页留给已收藏、已分享的旧地址和论坛最新窗口里的「3D 版块」按钮
 *   /docs /docs/:id
 *   /?open=<窗口应用的 id>  进桌面并打开这个窗口（YugcOs 读完把参数去掉）；控制台给的意见箱链接是 /?open=feedback
 *   旧地址只跳转、不再有单独的页面（#275，退场的页面归档在 docs/history/portal-yugc-os-v1/）：/feedback、/feedback/:org
 *   跳到 /?open=feedback（URL 里的组织名本来就不生效）；/join/:token（GitHub 组织邀请链接，随 #274 删掉的 /api/join/:token
 *   一起退场）和 /github 落到兜底路由回首页
 */
export default function App() {
  return (
    <Suspense fallback={<div className="pt-route-fallback" aria-busy="true" />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/join-us" element={<Navigate to="/?open=join" replace />} />
        <Route path="/apply" element={<Navigate to="/?open=join" replace />} />
        <Route path="/forum-3d" element={<Forum3D />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="/docs/:id" element={<Docs />} />
        <Route path="/feedback" element={<Navigate to="/?open=feedback" replace />} />
        <Route path="/feedback/:org" element={<Navigate to="/?open=feedback" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
