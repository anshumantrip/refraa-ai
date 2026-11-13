import { useState } from 'react';
import { Link, useLocation, useOutletContext, useParams } from 'react-router-dom';
import { api } from './api.js';
import { Field, Form, Heading, Notice, ResourceState, roleNames, Submit, useAction, useResource } from './ui.jsx';
import { RecruitingWorkspace, useRecruitingWorkspace } from './recruiting.jsx';
import { EmployeeOverview, EmployeeWorkspace, Referrals } from './referrals.jsx';

function Requests({ base }) {
  const [revision, setRevision] = useState(0);
  const resource = useResource(base + '/requests', revision);
  const action = useAction();
  return <section className="panel admin-panel">
    <h2>Membership requests</h2>
    <ResourceState resource={resource} />
    <Notice error={action.error} />
    {resource.data?.items.length === 0 && <p className="muted">No pending requests.</p>}
    {resource.data?.items.map(item => <form key={item.id} className="request-row" onSubmit={async event => {
      event.preventDefault();
      const role = new FormData(event.currentTarget).get('role');
      const decision = event.nativeEvent.submitter.value;
      const result = await action.run(() => api(base + '/requests/' + item.id, { method: 'POST', body: { role, decision } }));
      if (result) setRevision(previous => previous + 1);
    }}>
      <div><strong>{item.name}</strong><small>{item.email}</small></div>
      <select name="role" aria-label={'Role for ' + item.name}><option value="employee">Employee</option><option value="recruiter">Recruiter</option></select>
      <button className="button secondary" value="approve" disabled={action.busy}>Approve</button>
      <button className="button secondary" value="deny" disabled={action.busy}>Deny</button>
    </form>)}
  </section>;
}

function Invite({ base }) {
  const action = useAction();
  return <section className="panel admin-panel">
    <h2>Invite a colleague</h2>
    <Form action={action} onSubmit={values => action.run(() => api(base + '/invitations', { method: 'POST', body: values }))}>
      <Field label="Work email" name="email" type="email" />
      <Field label="Account type"><select name="role"><option value="employee">Employee</option><option value="recruiter">Recruiter</option></select></Field>
      <Submit busy={action.busy}>Send invitation</Submit>
    </Form>
  </section>;
}

export function Dashboard() {
  const { id } = useParams();
  const { pathname } = useLocation();
  const { user } = useOutletContext();
  const base = '/onboarding/organizations/' + id;
  const resource = useResource(base + '/dashboard');
  const data = resource.data;
  if (['company_admin', 'recruiter'].includes(data?.membership.role)) {
    return <RecruitingWorkspace data={data} user={user} />;
  }
  const root = '/dashboard/' + id;
  const section = pathname.slice(root.length).split('/')[1];
  if (data && ['referrals', 'opportunities', 'candidate', 'notifications'].includes(section)) {
    return <EmployeeWorkspace data={data} user={user} />;
  }
  if (data && section) {
    return <><Link className="back-link" to={'/dashboard/' + id}>← Dashboard</Link>
      <Notice error="Recruiter or company administrator access is required." /></>;
  }
  return <>
    <Link className="back-link" to="/companies">← Company directory</Link>
    <ResourceState resource={resource} />
    {data && <>
      <Heading title={data.organization.name} description="Workspace dashboard"><span className="pill heading-action">{roleNames[data.membership.role]}</span></Heading>
      <div className="panel dashboard-summary"><h2>Membership</h2><Notice message="Your company membership is verified." />
        <dl><div><dt>Account type</dt><dd>{roleNames[data.membership.role]}</dd></div><div><dt>Verification</dt><dd>{({ domain: 'Work email domain', invitation: 'Company invitation', approval: 'Administrator approval' })[data.membership.method]}</dd></div></dl>
      </div>
      <EmployeeWorkspace data={data} user={user}><div className="job-summary"><EmployeeOverview /><Referrals employee /></div></EmployeeWorkspace>
    </>}
  </>;
}

export function Employees() {
  const { data } = useRecruitingWorkspace();
  const base = '/onboarding/organizations/' + data.organization.id;
  return <><Heading title="Employees" description="Manage access to your company workspace." />
    {data.membership.role === 'company_admin' ? <div className="admin-grid"><Requests base={base} /><Invite base={base} /></div> :
      <div className="panel muted">Company administrators manage requests and invitations.</div>}
  </>;
}

export function Platform() {
  const resource = useResource('/onboarding/platform');
  return <>
    <Heading title="Platform administration" description="Super Admin overview" />
    <ResourceState resource={resource} />
    {resource.data && <div className="metrics">
      {[[resource.data.organizations, 'Active organizations'], [resource.data.accounts, 'Verified accounts'], [resource.data.pending, 'Pending companies']].map(([count, label]) =>
        <div className="panel" key={label}><strong>{count}</strong><p>{label}</p></div>)}
    </div>}
  </>;
}
