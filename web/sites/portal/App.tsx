import { Routes, Route, Navigate } from "react-router-dom";
import Landing from "./pages/Landing";
import Docs from "./pages/Docs";
import Feedback from "./pages/Feedback";
import JoinByToken from "./pages/JoinByToken";

/**
 * 官网路由。全部匿名可访问，无登录态概念。
 * 站内路径：/ /docs /docs/:id /feedback /feedback/:org /join/:token
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/docs" element={<Docs />} />
      <Route path="/docs/:id" element={<Docs />} />
      <Route path="/feedback" element={<Feedback />} />
      <Route path="/feedback/:org" element={<Feedback />} />
      <Route path="/join/:token" element={<JoinByToken />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
