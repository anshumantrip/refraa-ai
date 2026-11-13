import { Link, NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom';
import { Heading, ResourceState, roleNames, useResource } from './ui.jsx';
import { NoticeLink } from './referrals.jsx';

const sections = [
  ['Overview', '', '◫'], ['Jobs', '/jobs', '▤'], ['Resume Library', '/resume-library', '▧'],
  ['AI Matching', '/ai-matching', '✦'], ['Referrals', '/referrals', '↗'], ['Employees', '/employees', '◎'],
  ['Analytics', '/analytics', '▥'], ['Settings', '/settings', '⚙']
];

const metrics = [
  ['Total resumes uploaded', 'resumesUploaded'], ['Candidates processed', 'candidatesProcessed'],
  ['Active jobs', 'activeJobs'], ['Shortlisted candidates', 'shortlistedCandidates'],
  ['Pending approvals', 'pendingApprovals'], ['Completed referrals', 'completedReferrals']
];

export const jobStatusLabel = { draft: 'Draft', published: 'Published', archived: 'Archived' };
export const dateTime = value => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export function useRecruitingWorkspace() {
  return useOutletContext();
}

export function RecruitingWorkspace({ data, user }) {
  const { id } = useParams();
  const home = '/dashboard/' + id;
  const apiBase = '/organizations/' + id;
  return <div className="recruiting-workspace">
    <aside className="recruiting-sidebar">
      <div className="recruiting-company"><span className="avatar" aria-hidden="true">{data.organization.name.slice(0, 2).toUpperCase()}</span>
        <div><strong>{data.organization.name}</strong><small>{roleNames[data.membership.role]}</small></div>
      </div>
      <nav aria-label="Recruiting workspace">{sections.map(([label, path, icon]) =>
        <NavLink to={home + path} end={!path} key={label}><span aria-hidden="true">{icon}</span>{label}</NavLink>)}</nav>
      <div className="quick-actions"><NoticeLink /></div>
    </aside>
    <div className="recruiting-content"><Outlet context={{ home, apiBase, data, user }} /></div>
  </div>;
}

function MetricCards({ counts, keys = metrics }) {
  return <div className="recruiting-metrics">{keys.map(([label, key]) =>
    <div className="panel" key={key}><span>{label}</span><strong>{counts[key].toLocaleString()}</strong></div>)}</div>;
}

export function JobStatus({ status }) {
  return <span className={'pill job-status ' + status}>{jobStatusLabel[status]}</span>;
}

const activityLabels = { drafted: 'Draft saved', published: 'Job published', updated: 'Job updated', archived: 'Job archived' };

export function RecruitingOverview() {
  const { home, apiBase, user } = useRecruitingWorkspace();
  const resource = useResource(apiBase + '/recruiting-dashboard');
  return <>
    <div className="recruiting-heading">
      <Heading title={'Welcome, ' + user.name} description="Manage job requirements and see what’s happening in your workspace." />
      <Link className="button primary" to={home + '/jobs/new'}>Start New Screening</Link>
    </div>
    <ResourceState resource={resource} />
    {resource.data && <>
      <MetricCards counts={resource.data.metrics} />
      <div className="quick-actions" aria-label="Quick actions">
        <Link className="button secondary" to={home + '/jobs'}>Browse jobs</Link>
        <Link className="button secondary" to={home + '/jobs?status=draft'}>Open drafts</Link>
        <Link className="button secondary" to={home + '/analytics'}>View analytics</Link>
      </div>
      <div className="recruiting-overview-grid">
        <section className="panel workspace-list"><h2>Recent jobs</h2>
          {resource.data.recentJobs.length ? <ul>{resource.data.recentJobs.map(job =>
            <li key={job._id}><Link to={home + '/jobs/' + job._id}>{job.title}</Link><JobStatus status={job.status} /></li>
          )}</ul> : <p className="muted">No jobs yet. Create a draft to get started.</p>}
        </section>
        <section className="panel workspace-list"><h2>Recent activity</h2>
          {resource.data.activity.length ? <ul>{resource.data.activity.map((entry, index) =>
            <li key={entry._id + ':' + entry.at + ':' + index}><div><Link to={home + '/jobs/' + entry._id}>{entry.title}</Link>
              <small>{activityLabels[entry.kind]}</small></div><time dateTime={entry.at}>{dateTime(entry.at)}</time></li>
          )}</ul> : <p className="muted">Job activity will appear here.</p>}
        </section>
      </div>
    </>}
  </>;
}

const sectionInfo = {
  referrals: ['Referrals', ['pendingApprovals', 'completedReferrals'], 'Referral management is planned for a later phase.'],
  analytics: ['Analytics', metrics.map(([, key]) => key), 'Current totals for this organization.']
};

export function RecruitingMetricsPage({ section }) {
  const { apiBase } = useRecruitingWorkspace();
  const [title, keys, description] = sectionInfo[section];
  const resource = useResource(apiBase + '/recruiting-dashboard');
  return <><Heading title={title} description={description} /><ResourceState resource={resource} />
    {resource.data && <MetricCards counts={resource.data.metrics} keys={metrics.filter(([, key]) => keys.includes(key))} />}</>;
}

export function RecruitingSettings() {
  const { data, user } = useRecruitingWorkspace();
  return <><Heading title="Settings" description="Your account and workspace membership." />
    <div className="panel"><dl>
      <div><dt>Name</dt><dd>{user.name}</dd></div>
      <div><dt>Work email</dt><dd>{user.email}</dd></div>
      <div><dt>Organization</dt><dd>{data.organization.name}</dd></div>
      <div><dt>Account type</dt><dd>{roleNames[data.membership.role]}</dd></div>
    </dl></div></>;
}
