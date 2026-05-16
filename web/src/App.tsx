import { Routes, Route, Navigate } from "react-router-dom";
import Landing from "./pages/Landing";
import JoinByToken from "./pages/JoinByToken";
import Feedback from "./pages/Feedback";
import SignIn from "./pages/admin/SignIn";
import MyOrgs from "./pages/admin/MyOrgs";
import OrgLayout from "./pages/admin/OrgLayout";
import Overview from "./pages/admin/Overview";
import Members from "./pages/admin/Members";
import Repos from "./pages/admin/Repos";
import RepoDetail from "./pages/admin/RepoDetail";
import CreateRepo from "./pages/admin/CreateRepo";
import Invitations from "./pages/admin/Invitations";
import InviteLinks from "./pages/admin/InviteLinks";
import Teams from "./pages/admin/Teams";
import Activity from "./pages/admin/Activity";
import Security from "./pages/admin/Security";
import OrgSettings from "./pages/admin/OrgSettings";
import Logs from "./pages/admin/Logs";
import AdminFeedback from "./pages/admin/Feedback";
import Docs from "./pages/Docs";
import FeedbackFab from "./components/FeedbackFab";
import ForumLayout from "./pages/forum/ForumLayout";
import ForumHome from "./pages/forum/ForumHome";
import ForumCategoryList from "./pages/forum/ForumCategoryList";
import ForumCategory from "./pages/forum/ForumCategory";
import ForumThread from "./pages/forum/ForumThread";
import ForumNewThread from "./pages/forum/ForumNewThread";
import ForumLogin from "./pages/forum/ForumLogin";
import ForumRegister from "./pages/forum/ForumRegister";
import ForumProfile from "./pages/forum/ForumProfile";
import ForumMe from "./pages/forum/ForumMe";
import ForumNotifications from "./pages/forum/ForumNotifications";
import ForumArchive from "./pages/forum/ForumArchive";
import ForumAdmin from "./pages/forum/ForumAdmin";
import { detectSite } from "./lib/site";

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
        <Route path="repos/:repo/issues/:n" element={<RepoDetail />} />
        <Route path="repos/:repo/pulls/:n" element={<RepoDetail />} />
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
  return <FeedbackFab />;
}
