import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from './api.js';

export const roleNames = {
  employee: 'Employee / Referrer', recruiter: 'Recruiter',
  company_admin: 'Company Admin', super_admin: 'Super Admin'
};
export const industries = ['Technology', 'Finance', 'Consulting', 'E-commerce'];

export function Brand() {
  return <Link className="brand" to="/" aria-label="refraaAI home"><span className="brand-mark" aria-hidden="true">✦</span>refraa<span>AI</span></Link>;
}

export function AuthLayout({ children }) {
  return <div className="auth-layout">
    <aside className="auth-art">
      <Brand />
      <div className="orb" aria-hidden="true"><i /><i /><i /><b>✦</b></div>
      <div className="art-copy"><h2>Good people know<br />good people.</h2><p>A workspace for employee referrals.</p></div>
    </aside>
    <main className="auth-main"><div className="mobile-brand"><Brand /></div><div className="auth-content">{children}</div></main>
  </div>;
}

export function Heading({ title, description, children }) {
  return <div className="page-heading"><h1>{title}</h1>{description && <p>{description}</p>}{children}</div>;
}

export function Field({ label, children, ...props }) {
  return <label className="field"><span>{label}</span>{children || <input required {...props} />}</label>;
}

export function Notice({ error, message }) {
  return error ? <div role="alert" className="notice error">{error}</div> :
    message ? <div role="status" className="notice">{message}</div> : null;
}

export function Submit({ busy, children, ...props }) {
  return <button className="button primary" type="submit" disabled={busy} {...props}>{busy ? 'Please wait…' : children}</button>;
}

export function useAction() {
  const [state, setState] = useState({ busy: false, error: '', message: '' });
  async function run(work, onError) {
    if (state.busy) return;
    setState({ busy: true, error: '', message: '' });
    try {
      const result = await work();
      setState({ busy: false, error: '', message: result?.message || '' });
      return result;
    } catch (error) {
      setState({ busy: false, error: error.message, message: '' });
      onError?.(error);
    }
  }
  return { ...state, run };
}

export function useResource(path, revision = 0) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    api(path, { signal: controller.signal }).then(data => setState({ path, revision, data }),
      error => { if (!controller.signal.aborted) setState({ path, revision, error: error.message }); });
    return () => controller.abort();
  }, [path, revision]);
  return state?.path === path && state?.revision === revision ? state : { loading: Boolean(path) };
}

export function ResourceState({ resource }) {
  if (resource.loading) return <div className="panel muted" role="status">Loading…</div>;
  return <Notice error={resource.error} />;
}

export function Form({ action, onSubmit, children }) {
  return <form className="form" onSubmit={event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    onSubmit(values);
  }}>
    <Notice error={action.error} message={action.message} />{children}
  </form>;
}

export function PageFocus() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    const heading = document.querySelector('h1');
    if (heading && !document.activeElement?.matches('[data-otp-input]')) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [pathname]);
  return null;
}

export function Avatar({ company }) {
  const [failed, setFailed] = useState(false);
  const initials = company.name.split(/\s+/).slice(0, 2).map(word => word[0]).join('');
  return <span className="avatar" aria-hidden="true">{company.logo && !failed ?
    <img src={company.logo} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : initials}</span>;
}
