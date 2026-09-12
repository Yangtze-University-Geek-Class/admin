import { Routes, Route, Navigate } from "react-router-dom";
import SignIn from "./pages/SignIn";
import MyOrgs from "./pages/MyOrgs";
import OrgLayout from "./pages/OrgLayout";
import Overview from "./pages/Overview";
import Members from "./pages/Members";
import Repos from "./pages/Repos";
import RepoDetail from "./pages/RepoDetail";
import CreateRepo from "./pages/CreateRepo";
import Invitations from "./pages/Invitations";
import InviteLinks from "./pages/InviteLinks";
import Teams from "./pages/Teams";
import Activity from "./pages/Activity";
import Security from "./pages/Security";
import OrgSettings from "./pages/OrgSettings";
import Logs from "./pages/Logs";
import Feedback from "./pages/Feedback";

/**
 * 组织管理后台路由。强制 GitHub OAuth，权限由 GitHub 侧角色决定。
 * 站内路径：/ /signin /admin /admin/signin /admin /admin/:org/*
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route path="/signin" element={<SignIn />} />
      <Route path="/admin/signin" element={<SignIn />} />
      <Route path="/admin" element={<MyOrgs />} />
      <Route path="/admin/:org" element={<OrgLayout />}>
        <Route index element={<Overview />} />
        <Route path="members" element={<Members />} />
        <Route path="repos" element={<Repos />} />
        <Route path="repos/new" element={<CreateRepo />} />
        <Route path="repos/:repo/*" element={<RepoDetail />} />
        <Route path="invitations" element={<Invitations />} />
        <Route path="invite-links" element={<InviteLinks />} />
        <Route path="teams" element={<Teams />} />
        <Route path="activity" element={<Activity />} />
        <Route path="security" element={<Security />} />
        <Route path="org" element={<OrgSettings />} />
        <Route path="feedback" element={<Feedback />} />
        <Route path="logs" element={<Logs />} />
      </Route>
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}
