import { Routes, Route, Navigate } from "react-router-dom";
import ForumLayout from "./pages/ForumLayout";
import ForumHome from "./pages/ForumHome";
import ForumCategoryList from "./pages/ForumCategoryList";
import ForumCategory from "./pages/ForumCategory";
import ForumThread from "./pages/ForumThread";
import ForumNewThread from "./pages/ForumNewThread";
import ForumLogin from "./pages/ForumLogin";
import ForumRegister from "./pages/ForumRegister";
import ForumProfile from "./pages/ForumProfile";
import ForumMe from "./pages/ForumMe";
import ForumNotifications from "./pages/ForumNotifications";
import ForumArchive from "./pages/ForumArchive";
import ForumAdmin from "./pages/ForumAdmin";
import ForumTeacher from "./pages/ForumTeacher";

/**
 * 论坛路由。会话是独立的 forum_sid，与后台的 GitHub OAuth 不共享。
 * 站内路径：/ /categories /c/:slug /t/:id /new /login /register
 *          /u/:username /me /me/notifications /archive /archive/t/:id /admin /teacher
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ForumLayout />}>
        <Route index element={<ForumHome />} />
        <Route path="categories" element={<ForumCategoryList />} />
        <Route path="c/:slug" element={<ForumCategory />} />
        <Route path="t/:id" element={<ForumThread />} />
        <Route path="new" element={<ForumNewThread />} />
        <Route path="login" element={<ForumLogin />} />
        <Route path="register" element={<ForumRegister />} />
        <Route path="u/:username" element={<ForumProfile />} />
        <Route path="me" element={<ForumMe />} />
        <Route path="me/notifications" element={<ForumNotifications />} />
        <Route path="archive" element={<ForumArchive />} />
        <Route path="archive/t/:id" element={<ForumThread />} />
        <Route path="admin" element={<ForumAdmin />} />
        <Route path="teacher" element={<ForumTeacher />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
