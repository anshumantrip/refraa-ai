import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api.js';
import { Login, Register, Verify, Recovery } from './auth.jsx';
import { AccountType, AddCompany, Complete, Directory, Membership, Profile } from './onboarding.jsx';
import { Dashboard, Employees, Platform } from './dashboard.jsx';
import { RecruitingOverview, RecruitingSettings } from './recruiting.jsx';
import { Analytics, Notifications, Opportunities, Opportunity, ReferralDetail, ReferralProfile, Referrals } from './referrals.jsx';
import { JobDetail, Jobs } from './jobs.jsx';
import { JobWizard } from './job-wizard.jsx';
import { MatchingHome, MatchingHistory, MatchingRunView } from './matching.jsx';
import { ResumeLibrary, ResumeUpload, ResumeBatch, ResumeBatches, ResumeDetail } from './resume-library.jsx';
import { AuthLayout, Brand, Heading, Notice, PageFocus, ResourceState, useAction, useResource } from './ui.jsx';
import './style.css';
import './recruiting.css';
import './resumes.css';
import './matching.css';

function Workspace({ user, logout }) {
  const action = useAction();
  return <>
    <header className="workspace-header"><div className="header-inner">
      <Brand /><nav aria-label="Workspace">
        <Link to="/companies">Companies</Link>
        {user.systemRole === 'super_admin' && <Link to="/platform">Administration</Link>}
      </nav>
      <div className="account"><span>{user.name}</span><button className="button secondary" type="button" disabled={action.busy}
        onClick={() => action.run(async () => { await api('/auth/logout', { method: 'POST' }); logout(); })}>Sign out</button></div>
    </div></header>
    <main className="workspace-main"><Notice error={action.error} /><Outlet context={{ user }} /></main>
  </>;
}

function WorkspaceHome() {
  const resource = useResource('/onboarding/memberships');
  const workspaces = resource.data?.items.filter(item => item.status === 'verified' &&
    item.organization.active && item.organization.company.status === 'verified' && ['recruiter', 'company_admin'].includes(item.role));
  if (!workspaces) return <><ResourceState resource={resource} />
    {resource.error && <Link to="/companies">Open company directory</Link>}</>;
  return <Navigate to={workspaces.length === 1 ? '/dashboard/' + workspaces[0].organization._id : '/companies'} replace />;
}

function App() {
  const [session, setSession] = useState({ loading: true });
  const location = useLocation();
  useEffect(() => {
    const controller = new AbortController();
    api('/auth/me', { signal: controller.signal }).then(({ user }) => setSession({ user }),
      error => {
        if (!controller.signal.aborted) setSession(error.status === 401 ? {} : { error: error.message });
      });
    return () => controller.abort();
  }, []);
  if (session.loading) return <AuthLayout><p role="status">Loading your workspace…</p></AuthLayout>;
  if (session.error) return <AuthLayout><Notice error={session.error} />
    <button className="button secondary" onClick={() => window.location.reload()}>Retry</button></AuthLayout>;
  const user = session.user;
  const protectedWorkspace = user ? <Workspace user={user} logout={() => setSession({})} /> :
    <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <><PageFocus /><Routes>
    <Route path="/login" element={user ? <Navigate to={/^\/dashboard\/[a-f0-9]{24}(?:\/|$)/i.test(location.state?.from || '') ? location.state.from : '/'} replace /> :
      <AuthLayout><Login onLogin={user => setSession({ user })} /></AuthLayout>} />
    <Route path="/register" element={user ? <Navigate to="/companies" replace /> : <AuthLayout><Register /></AuthLayout>} />
    <Route path="/verify" element={<AuthLayout><Verify /></AuthLayout>} />
    <Route path="/forgot" element={<AuthLayout><Recovery key="forgot" /></AuthLayout>} />
    <Route path="/reset" element={<AuthLayout><Recovery key="reset" reset /></AuthLayout>} />
    <Route element={protectedWorkspace}>
      <Route path="/" element={<WorkspaceHome />} />
      <Route path="/companies" element={<Directory />} />
      <Route path="/companies/new" element={<AddCompany />} />
      <Route path="/companies/:id" element={<Profile />} />
      <Route path="/membership/:id" element={<Membership />} />
      <Route path="/account-type/:id" element={<AccountType />} />
      <Route path="/complete/:id" element={<Complete />} />
      <Route path="/dashboard/:id" element={<Dashboard />}>
        <Route index element={<RecruitingOverview />} />
        <Route path="jobs" element={<Jobs />} />
        <Route path="jobs/new" element={<JobWizard />} />
        <Route path="jobs/:jobId" element={<JobDetail />} />
        <Route path="jobs/:jobId/edit" element={<JobWizard />} />
        <Route path="resume-library" element={<ResumeLibrary />} />
        <Route path="resume-library/upload" element={<ResumeUpload />} />
        <Route path="resume-library/batches" element={<ResumeBatches />} />
        <Route path="resume-library/batches/:batchId" element={<ResumeBatch />} />
        <Route path="resume-library/files/:resumeId" element={<ResumeDetail />} />
        <Route path="ai-matching" element={<MatchingHome />} />
        <Route path="ai-matching/jobs/:jobId" element={<MatchingHistory />} />
        <Route path="ai-matching/runs/:runId" element={<MatchingRunView />} />
        <Route path="referrals" element={<Referrals />} />
        <Route path="referrals/:referralId" element={<ReferralDetail />} />
        <Route path="candidate/:runId/:candidateId" element={<ReferralProfile />} />
        <Route path="opportunities" element={<Opportunities />} />
        <Route path="opportunities/:jobId" element={<Opportunity />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="employees" element={<Employees />} />
        <Route path="settings" element={<RecruitingSettings />} />
      </Route>
      <Route path="/platform" element={<Platform />} />
    </Route>
    <Route path="*" element={<AuthLayout><Heading title="Page not found" /><Link to="/">Return home</Link></AuthLayout>} />
  </Routes></>;
}

createRoot(document.getElementById('root')).render(<BrowserRouter><App /></BrowserRouter>);
