import { Routes, Route, Navigate } from "react-router-dom";
import Landing from "../sites/portal/pages/Landing";
import JoinByToken from "../sites/portal/pages/JoinByToken";
import Feedback from "../sites/portal/pages/Feedback";
import SignIn from "../sites/admin/pages/SignIn";
import MyOrgs from "../sites/admin/pages/MyOrgs";
import OrgLayout from "../sites/admin/pages/OrgLayout";
import Overview from "../sites/admin/pages/Overview";
import Members from "../sites/admin/pages/Members";
import Repos from "../sites/admin/pages/Repos";
import RepoDetail from "../sites/admin/pages/RepoDetail";
import CreateRepo from "../sites/admin/pages/CreateRepo";
import Invitations from "../sites/admin/pages/Invitations";
import InviteLinks from "../sites/admin/pages/InviteLinks";
import Teams from "../sites/admin/pages/Teams";
import Activity from "../sites/admin/pages/Activity";
import Security from "../sites/admin/pages/Security";
import OrgSettings from "../sites/admin/pages/OrgSettings";
import Logs from "../sites/admin/pages/Logs";
import AdminFeedback from "../sites/admin/pages/Feedback";
import Docs from "../sites/portal/pages/Docs";
import FeedbackFab from "@shared/ui/FeedbackFab";
import ForumLayout from "../sites/forum/pages/ForumLayout";
import ForumHome from "../sites/forum/pages/ForumHome";
import ForumCategoryList from "../sites/forum/pages/ForumCategoryList";
import ForumCategory from "../sites/forum/pages/ForumCategory";
import ForumThread from "../sites/forum/pages/ForumThread";
import ForumNewThread from "../sites/forum/pages/ForumNewThread";
import ForumLogin from "../sites/forum/pages/ForumLogin";
import ForumRegister from "../sites/forum/pages/ForumRegister";
import ForumProfile from "../sites/forum/pages/ForumProfile";
import ForumMe from "../sites/forum/pages/ForumMe";
import ForumNotifications from "../sites/forum/pages/ForumNotifications";
import ForumArchive from "../sites/forum/pages/ForumArchive";
import ForumAdmin from "../sites/forum/pages/ForumAdmin";
import ForumTeacher from "../sites/forum/pages/ForumTeacher";
import { detectSite } from "@shared/lib/site";

export default function App() {
  const site = detectSite();
  if (site.kind === "forum") return <ForumRoutes />;
  if (site.kind === "admin") return <AdminRoutes />;
  return <PortalRoutes />;
}

function PortalRoutes() {
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

function ForumRoutes() {
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

function AdminRoutes() {
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
        <Route path="feedback" element={<AdminFeedback />} />
        <Route path="logs" element={<Logs />} />
      </Route>
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}

export function GlobalFab() {
  const site = detectSite();
  if (site.kind === "portal") return null;
  return <FeedbackFab raised={site.kind === "forum"} />;
}
