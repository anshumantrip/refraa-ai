import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from './api.js';
import { Avatar, Field, Form, Heading, industries, Notice, ResourceState, roleNames, Submit, useAction, useResource } from './ui.jsx';

export function Directory() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const industry = params.get('industry') || '';
  const page = Number(params.get('page')) || 1;
  const search = new URLSearchParams({ q, page: String(page), ...(industry && { industry }) });
  const resource = useResource('/companies?' + search);
  const memberships = useResource('/onboarding/memberships');
  return <>
    <Heading title="Find your company" description="Choose your employer to start or resume membership verification.">
      <Link className="button secondary heading-action" to="/companies/new">+ Add company</Link>
    </Heading>
    <ResourceState resource={memberships} />
    {!!memberships.data?.items.length && <section className="resume-list" aria-label="Your memberships">
      {memberships.data.items.map(item => <Link key={item.id} className="pill"
        to={item.role && item.organization.active ? '/dashboard/' + item.organization._id : '/membership/' + item.organization._id}>
        {item.organization.company.name} · {item.role && item.organization.active ? 'Open workspace' : item.status === 'denied' ? 'Declined' : 'View request'}
      </Link>)}
    </section>}
    <form className="filters" key={q + ':' + industry} onSubmit={event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      setParams(new URLSearchParams({ q: data.get('q').trim(), ...(data.get('industry') && { industry: data.get('industry') }) }));
    }}>
      <Field label="Company name"><input type="search" name="q" placeholder="Search companies" defaultValue={q} maxLength={100} /></Field>
      <Field label="Industry"><select name="industry" defaultValue={industry}><option value="">All industries</option>
        {industries.map(value => <option key={value}>{value}</option>)}</select></Field>
      <button className="button secondary" type="submit">Search</button>
    </form>
    <ResourceState resource={resource} />
    {resource.data && <>
      <p className="result-count" role="status">{resource.data.total} {resource.data.total === 1 ? 'company' : 'companies'}</p>
      {resource.data.items.length ? <div className="company-grid">
        {resource.data.items.map(company => <Link className="company-card" to={'/companies/' + company._id} key={company._id}>
          <Avatar company={company} /><span><strong>{company.name}</strong><small>{company.industry}</small></span><span className="card-arrow" aria-hidden="true">↗</span>
        </Link>)}
      </div> : <div className="panel muted">No companies match. Try a different search or add your company.</div>}
      {resource.data.pages > 1 && <nav className="pagination" aria-label="Company pages">
        <button className="button secondary" type="button" disabled={page <= 1} onClick={() => { search.set('page', String(page - 1)); setParams(search); }}>Previous</button>
        <span>Page {page} of {resource.data.pages}</span>
        <button className="button secondary" type="button" disabled={page >= resource.data.pages} onClick={() => { search.set('page', String(page + 1)); setParams(search); }}>Next</button>
      </nav>}
    </>}
  </>;
}

export function AddCompany() {
  const action = useAction();
  const navigate = useNavigate();
  return <section className="narrow">
    <Link className="back-link" to="/companies">← Company directory</Link>
    <Heading title="Add your company" description="New companies appear as pending while an operator verifies the organization." />
    <div className="panel">
      <Form action={action} onSubmit={async values => {
        const result = await action.run(() => api('/companies', { method: 'POST', body: values }));
        if (result) navigate('/companies/' + result.item._id);
      }}>
        <Field label="Company name" name="name" minLength={2} maxLength={100} />
        <Field label="Official website" type="url" name="website" placeholder="https://example.com" />
        <Field label="Industry"><select name="industry" defaultValue="" required><option value="" disabled>Select an industry</option>
          {industries.map(industry => <option key={industry}>{industry}</option>)}</select></Field>
        <Submit busy={action.busy}>Submit company</Submit>
      </Form>
    </div>
  </section>;
}

export function Profile() {
  const { id } = useParams();
  const resource = useResource('/companies/' + id);
  const action = useAction();
  const navigate = useNavigate();
  const company = resource.data?.item;
  return <section className="narrow">
    <Link className="back-link" to="/companies">← Company directory</Link>
    <ResourceState resource={resource} />
    {company && <>
      <div className="profile-title"><Avatar key={company._id} company={company} />
        <Heading title={company.name} description={company.industry} /></div>
      <div className="panel profile">
        <dl>
          <div><dt>Company status</dt><dd>{({ verified: 'Verified organization', listed: 'Directory listing', pending: 'Pending verification' })[company.status]}</dd></div>
          {company.headquarters && <div><dt>Headquarters</dt><dd>{company.headquarters}</dd></div>}
          {company.description && <div><dt>About</dt><dd>{company.description}</dd></div>}
          <div><dt>Website</dt><dd><a href={company.website} target="_blank" rel="noreferrer">{new URL(company.website).hostname} ↗</a></dd></div>
          {company.careers && <div><dt>Careers</dt><dd><a href={company.careers} target="_blank" rel="noreferrer">Explore roles ↗</a></dd></div>}
          {company.source && <div><dt>Source</dt><dd><a href={company.source} target="_blank" rel="noreferrer">Company information ↗</a></dd></div>}
        </dl>
        <Notice error={action.error} />
        <button className="button primary" type="button" disabled={action.busy} onClick={async () => {
          const result = await action.run(() => api('/onboarding/company', { method: 'POST', body: { companyId: company._id } }));
          if (result) navigate('/membership/' + result.organization);
        }}>{action.busy ? 'Saving…' : 'Select this company'}</button>
      </div>
    </>}
  </section>;
}

export function Membership() {
  const { id } = useParams();
  const [revision, setRevision] = useState(0);
  const resource = useResource('/onboarding/company/' + id, revision);
  const action = useAction();
  const navigate = useNavigate();
  const membership = resource.data?.membership;
  async function verify(values) {
    const invitation = values.invitation?.trim();
    const result = await action.run(() => api('/onboarding/company/' + id + '/verify', {
      method: 'POST', body: invitation ? { invitation } : {}
    }));
    if (result?.membership.status === 'verified') navigate('/account-type/' + id);
    else if (result) setRevision(previous => previous + 1);
  }
  return <section className="narrow">
    <Link className="back-link" to="/companies">← Company directory</Link>
    <Heading title="Verify your membership" description={resource.data ? 'Continue your request to join ' + resource.data.company.name + '.' : undefined} />
    <ResourceState resource={resource} />
    {membership && <div className="panel">
      {membership.status === 'denied' ? <Notice error="Your request was declined. Contact your company administrator." /> :
        membership.status === 'verified' ?
          <><Notice message="Your membership is verified." /><Link className="button primary" to={membership.role ? '/dashboard/' + id : '/account-type/' + id}>Continue</Link></> :
          <Form action={action} onSubmit={verify}>
            <p className="muted">Use your approved email domain or enter a code from your company administrator. If your request needs a review, it stays pending until an administrator responds.</p>
            {revision > 0 && <Notice message="Your membership request is still pending." />}
            <Field label="Invitation code (optional)"><input name="invitation" autoComplete="off" maxLength={64} /></Field>
            <Submit busy={action.busy}>Check verification</Submit>
          </Form>}
    </div>}
  </section>;
}

const descriptions = {
  employee: 'Access your workspace as an employee and referrer.',
  recruiter: 'Access the recruiting workspace with company approval.',
  company_admin: 'Manage membership requests and company invitations.'
};

export function AccountType() {
  const { id } = useParams();
  const resource = useResource('/onboarding/company/' + id);
  const action = useAction();
  const navigate = useNavigate();
  const member = resource.data?.membership;
  const options = member?.grant === 'company_admin' ? ['company_admin'] : ['employee', 'recruiter'];
  return <section className="narrow">
    <Link className="back-link" to={'/membership/' + id}>← Membership</Link>
    <Heading title="Choose your account type" description="Your organization controls which roles are available." />
    <ResourceState resource={resource} />
    {member && (member.status === 'verified' ? <div className="panel">
      <Form action={action} onSubmit={async values => {
        const result = await action.run(() => api('/onboarding/company/' + id + '/role', { method: 'POST', body: values }));
        if (result) navigate('/complete/' + id);
      }}>
        <fieldset className="role-list"><legend>Account types</legend>
          {options.map(role => {
            const enabled = role === member.grant || (role === 'employee' && member.grant === 'recruiter');
            return <label className="role-option" key={role}>
              <input type="radio" name="role" value={role} disabled={!enabled} required defaultChecked={role === (member.role || member.grant)} />
              <span><strong>{roleNames[role]}</strong><small>{enabled ? descriptions[role] : 'Requires a recruiter invitation or administrator approval.'}</small></span>
            </label>;
          })}
        </fieldset>
        <Submit busy={action.busy}>Finish onboarding</Submit>
      </Form>
    </div> : <Notice error="Verify your membership before choosing an account type." />)}
  </section>;
}

export function Complete() {
  const { id } = useParams();
  const resource = useResource('/onboarding/organizations/' + id + '/dashboard');
  return <section className="narrow">
    <ResourceState resource={resource} />
    {resource.data && <div className="panel completion">
      <span className="brand-mark" aria-hidden="true">✓</span>
      <Heading title="Your workspace is ready" description={resource.data.organization.name + ' · ' + roleNames[resource.data.membership.role]} />
      <Link className="button primary" to={'/dashboard/' + id}>Open dashboard</Link>
    </div>}
  </section>;
}
