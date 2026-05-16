import { Routes, Route, Navigate } from "react-router-dom";
import Landing from "./pages/Landing";
import JoinByToken from "./pages/JoinByToken";
import SignIn from "./pages/admin/SignIn";
import MyOrgs from "./pages/admin/MyOrgs";
import OrgLayout from "./pages/admin/OrgLayout";
import Overview from "./pages/admin/Overview";
import Members from "./pages/admin/Members";
import Repos from "./pages/admin/Repos";
import RepoDetail from "./pages/admin/RepoDetail";
import Invitations from "./pages/admin/Invitations";
import InviteLinks from "./pages/admin/InviteLinks";
import Teams from "./pages/admin/Teams";
import Activity from "./pages/admin/Activity";
import Security from "./pages/admin/Security";
import OrgSettings from "./pages/admin/OrgSettings";
import Logs from "./pages/admin/Logs";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/join/:token" element={<JoinByToken />} />
      <Route path="/admin/signin" element={<SignIn />} />
      <Route path="/admin" element={<MyOrgs />} />
      <Route path="/admin/:org" element={<OrgLayout />}>
        <Route index element={<Overview />} />
        <Route path="members" element={<Members />} />
        <Route path="repos" element={<Repos />} />
        <Route path="repos/:repo" element={<RepoDetail />} />
        <Route path="invitations" element={<Invitations />} />
        <Route path="invite-links" element={<InviteLinks />} />
        <Route path="teams" element={<Teams />} />
        <Route path="activity" element={<Activity />} />
        <Route path="security" element={<Security />} />
        <Route path="org" element={<OrgSettings />} />
        <Route path="logs" element={<Logs />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
