import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api.js';
import { Login, Register, Verify, Recovery } from './auth.jsx';
import { AccountType, AddCompany, Complete, Directory, Membership, Profile } from './onboarding.jsx';
import { Dashboard, Platform } from './dashboard.jsx';
import { AuthLayout, Brand, Heading, Notice, PageFocus, useAction } from './ui.jsx';
import './style.css';

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
    <main className="workspace-main"><Notice error={action.error} /><Outlet /></main>
  </>;
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
    <Route path="/" element={<Navigate to={user ? '/companies' : '/login'} replace />} />
    <Route path="/login" element={user ? <Navigate to="/companies" replace /> :
      <AuthLayout><Login onLogin={user => setSession({ user })} /></AuthLayout>} />
    <Route path="/register" element={user ? <Navigate to="/companies" replace /> : <AuthLayout><Register /></AuthLayout>} />
    <Route path="/verify" element={<AuthLayout><Verify /></AuthLayout>} />
    <Route path="/forgot" element={<AuthLayout><Recovery key="forgot" /></AuthLayout>} />
    <Route path="/reset" element={<AuthLayout><Recovery key="reset" reset /></AuthLayout>} />
    <Route element={protectedWorkspace}>
      <Route path="/companies" element={<Directory />} />
      <Route path="/companies/new" element={<AddCompany />} />
      <Route path="/companies/:id" element={<Profile />} />
      <Route path="/membership/:id" element={<Membership />} />
      <Route path="/account-type/:id" element={<AccountType />} />
      <Route path="/complete/:id" element={<Complete />} />
      <Route path="/dashboard/:id" element={<Dashboard />} />
      <Route path="/platform" element={<Platform />} />
    </Route>
    <Route path="*" element={<AuthLayout><Heading title="Page not found" /><Link to="/">Return home</Link></AuthLayout>} />
  </Routes></>;
}

createRoot(document.getElementById('root')).render(<BrowserRouter><App /></BrowserRouter>);
