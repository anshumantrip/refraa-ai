import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { api } from './api.js';
import { Heading, Field, Notice, ResourceState, useAction, useResource } from './ui.jsx';

const labels = { recommended: 'Recommended', pending_review: 'Pending Review', approved: 'Approved',
  rejected: 'Rejected', submitted: 'Submitted', completed: 'Completed' };
const date = value => new Date(value).toLocaleString();
function useReferrals() {
  const { id } = useParams();
  return { base: '/organizations/' + id + '/referrals', home: '/dashboard/' + id };
}

function Pages({ page, pages, change }) {
  return pages > 1 && <nav className="pagination" aria-label="Pagination">
    <button className="button secondary" disabled={page <= 1} onClick={() => change(page - 1)}>Previous</button>
    <span>Page {page} of {pages}</span>
    <button className="button secondary" disabled={page >= pages} onClick={() => change(page + 1)}>Next</button>
  </nav>;
}

export function NoticeLink() {
  const { base, home } = useReferrals();
  const [revision, setRevision] = useState(0);
  const { pathname } = useLocation();
  useEffect(() => {
    const timer = setInterval(() => setRevision(value => value + 1), 20000);
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener('refraa-notification-read', refresh);
    return () => { clearInterval(timer); window.removeEventListener('refraa-notification-read', refresh); };
  }, []);
  const notices = useResource(base + '/notifications/count', pathname + ':' + revision);
  return <Link to={home + '/notifications'} onFocus={() => setRevision(value => value + 1)}>Notifications
    {!!notices.data?.unread && <span className="pill" aria-label={notices.data.unread + ' unread'}>{notices.data.unread}</span>}</Link>;
}

export function EmployeeWorkspace({ data, user, children }) {
  const { home } = useReferrals();
  return <><nav className="quick-actions" aria-label="Employee workspace">
    <Link to={home}>Overview</Link><Link to={home + '/opportunities'}>Job opportunities</Link>
    <Link to={home + '/referrals'}>My referrals</Link><NoticeLink />
  </nav>{children || <Outlet context={{ data, user }} />}</>;
}

export function EmployeeOverview() {
  const { base, home } = useReferrals();
  const jobs = useResource(base + '/opportunities');
  return <section className="panel"><h2>Published job opportunities</h2><ResourceState resource={jobs} />
    {jobs.data?.jobs.slice(0, 5).map(job => <p key={job._id}><Link to={home + '/opportunities/' + job._id}>{job.title}</Link></p>)}
    {jobs.data?.jobs.length === 0 && <p className="muted">No published opportunities.</p>}
    <Link to={home + '/opportunities'}>Browse job opportunities</Link>
  </section>;
}

export function Opportunities() {
  const { base, home } = useReferrals();
  const [page, setPage] = useState(1);
  const resource = useResource(base + '/opportunities?page=' + page);
  return <><Heading title="Job opportunities" /><ResourceState resource={resource} />
    {resource.data && <><ul className="job-list">{resource.data.jobs.map(job =>
      <li key={job._id}><Link className="job-list-row" to={home + '/opportunities/' + job._id}>{job.title}</Link></li>)}</ul>
      {!resource.data.jobs.length && <p className="panel muted">No published opportunities.</p>}
      <Pages page={page} pages={resource.data.pages} change={setPage} /></>}</>;
}

export function Opportunity() {
  const { base, home } = useReferrals();
  const { jobId } = useParams();
  const resource = useResource(base + '/opportunities/' + jobId);
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState('rank');
  const [selected, setSelected] = useState([]);
  const items = resource.data?.items.filter(item => [item.name, ...(item.skills || [])].join(' ').toLowerCase().includes(query.toLowerCase()));
  if (order === 'name') items?.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return <><Link to={home + '/opportunities'}>← Opportunities</Link><ResourceState resource={resource} />
    {resource.data && <><Heading title={resource.data.job.title} description={resource.data.job.description} />
      <div className="quick-actions"><Field label="Search name or skill"><input value={query} onChange={e => setQuery(e.target.value)} /></Field>
        <Field label="Sort candidates"><select value={order} onChange={e => setOrder(e.target.value)}><option value="rank">Match rank</option><option value="name">Name</option></select></Field></div>
      {!items.length && <p className="panel muted">No recommended candidates match this view.</p>}
      <ul className="job-list">{items.map(item => <li className="panel" key={item._id}>
        <Link to={home + '/candidate/' + resource.data.runId + '/' + item._id}>{item.name || 'Unknown candidate'}</Link>
        <label className="job-check"><input type="checkbox" checked={selected.includes(item._id)}
          disabled={!selected.includes(item._id) && selected.length >= 4}
          onChange={e => setSelected(e.target.checked ? [...selected, item._id] : selected.filter(id => id !== item._id))} /> Compare</label>
      </li>)}</ul>
      {selected.length >= 2 && <section className="panel"><h2>Candidate comparison</h2><div className="matching-comparison">
        {resource.data.items.filter(item => selected.includes(item._id)).map(item => <div key={item._id}><strong>{item.name || 'Unknown'}</strong>
          <p>{item.skills.join(', ') || 'No skills documented'}</p></div>)}</div></section>}
    </>}</>;
}

function Entries({ title, items }) {
  return <section className="panel"><h2>{title}</h2>{items?.length ? <ul>{items.map((item, i) =>
    <li key={i}>{typeof item === 'string' ? item : item.text}{item.cgpa != null && ' · CGPA ' + item.cgpa + (item.scale ? '/' + item.scale : '')}</li>)}</ul> : <p className="muted">Unknown or unavailable.</p>}</section>;
}

export function ReferralProfile() {
  const { base, home } = useReferrals();
  const { runId, candidateId } = useParams();
  const resource = useResource(base + '/profiles/' + runId + '/' + candidateId);
  const action = useAction();
  const navigate = useNavigate();
  const data = resource.data;
  const prepare = async prepare => {
    const result = await action.run(() => api(base, { method: 'POST', body: { run: runId, candidate: candidateId, prepare } }));
    if (result) navigate(home + '/referrals/' + result.id);
  };
  return <><ResourceState resource={resource} /><Notice error={action.error} />
    {data && <><Heading title={data.candidate.name || 'Unknown candidate'} description={data.job.title} />
      <div className="quick-actions">
        <button className="button primary" disabled={action.busy || data.job.currentStatus !== 'published'} onClick={() => prepare(false)}>Create referral request</button>
        <button className="button secondary" disabled={action.busy || data.job.currentStatus !== 'published'} onClick={() => prepare(true)}>Prepare referral</button>
        {data.resume?.scanPassed && <a href={'/api' + base + '/profiles/' + runId + '/' + candidateId + '/original'}>Download original</a>}
      </div>
      <div className="job-summary">
        {data.resume && <section className="panel"><h2>Contact</h2><p>{data.candidate.email || 'Email unavailable'}</p><p>{data.candidate.phone || 'Phone unavailable'}</p></section>}
        <Entries title="Technical skills" items={data.candidate.skills} />
        {data.resume && [['Education', 'education'], ['Work experience', 'experience'], ['Internships', 'internships'],
          ['Projects', 'projects'], ['Certifications', 'certifications']].map(([title, key]) => <Entries key={key} title={title} items={data.candidate[key]} />)}
        <section className="panel"><h2>Job criteria and assessment</h2><p>{data.job.criteria.description}</p><p>Match score: {data.assessment.score}%</p>
          <p>{data.assessment.explanation}</p>
          <p>Required: {data.job.criteria.requiredSkills.map(item => item.name).join(', ') || 'None'}</p>
          <p>Preferred: {data.job.criteria.preferredSkills.map(item => item.name).join(', ') || 'None'}</p>
          <p>Experience: {data.job.criteria.experienceCriteria ? 'Enabled' : 'Disabled'} {data.assessment.experience?.state}</p>
          <p>CGPA: {data.job.criteria.cgpaCriteria ? 'Enabled' : 'Disabled'} {data.assessment.cgpa?.state}</p>
          {[...(data.assessment.required || []), ...(data.assessment.preferred || []), ...(data.assessment.additional || [])].map((item, i) =>
            <details key={i}><summary>{item.label} · {item.state}</summary>
              {item.evidence?.map((e, j) => <p key={j}>Line {e.line ?? 'unknown'} · {e.text}</p>)}</details>)}
          {[...(data.assessment.experience?.evidence || []), ...(data.assessment.cgpa?.evidence || []),
            ...(data.assessment.projects || []).map(item => item.evidence)].map((e, i) => <p key={i}>{e.section} · Line {e.line ?? 'unknown'} · {e.text}</p>)}
        </section>
        <section className="panel"><h2>Referral history</h2>{data.history.length ? data.history.map(item =>
          <p key={item._id}>{labels[item.status]} · {date(item.updatedAt)}</p>) : <p className="muted">No referrals yet.</p>}</section>
      </div>
    </>}</>;
}

export function Referrals({ employee = false }) {
  const { base, home } = useReferrals();
  const context = useOutletContext();
  const manager = !employee && context?.data?.membership.role !== 'employee';
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState('');
  const resource = useResource(base + '?page=' + page + '&' + filters);
  const [revision, setRevision] = useState(0);
  const policy = useResource(manager ? base + '/policy' : null, revision);
  const action = useAction();
  return <><Heading title={manager ? 'Referrals' : 'My referrals'} />
    {manager && <Link to={home + '/opportunities'}>Browse opportunities and compare candidates</Link>}
    {policy.data && <div className="quick-actions"><label><input type="checkbox" checked={policy.data.independent} disabled={action.busy}
      onChange={async event => {
        if (await action.run(() => api(base + '/policy', { method: 'PUT', body: { independent: event.target.checked } }))) setRevision(value => value + 1);
      }} /> Require independent review</label></div>}
    <Notice error={action.error} />
    <form className="filters" onSubmit={event => {
      event.preventDefault();
      const next = new URLSearchParams(new FormData(event.currentTarget));
      for (const [key, value] of [...next]) if (!value.trim()) next.delete(key);
      setFilters(next.toString()); setPage(1);
    }}>
      <Field label="Job or candidate"><input name="q" maxLength={100} /></Field>
      <Field label="Status"><select name="status"><option value="">All referrals</option>
        {Object.entries(labels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></Field>
      {manager && <Field label="Referrer"><input name="referrer" maxLength={100} /></Field>}
      <button className="button secondary">Filter referrals</button>
    </form>
    <ResourceState resource={resource} />
    {resource.data && (!resource.data.items.length ? <p className="panel muted">No referrals match.</p> :
      <ul className="job-list">{resource.data.items.map(row => <li key={row._id}>
        <Link className="job-list-row" to={home + '/referrals/' + row._id}><strong>{row.name || 'Unknown candidate'} · {row.title || 'Job'}</strong>
          <span className="pill">{labels[row.status]}</span><span>{manager ? row.referrerName : date(row.updatedAt)}</span></Link>
      </li>)}</ul>)}
    <Pages page={page} pages={resource.data?.pages} change={setPage} />
  </>;
}

const decisionLabels = { pending_review: 'Send for review', approved: 'Approve', rejected: 'Reject',
  submitted: 'Record submission', completed: 'Mark completed' };
export function ReferralDetail() {
  const { base, home } = useReferrals();
  const { referralId } = useParams();
  const path = base + '/' + referralId;
  const [revision, setRevision] = useState(0);
  const [decision, setDecision] = useState('');
  const resource = useResource(path, revision);
  const action = useAction();
  const data = resource.data;
  return <><Link to={home + '/referrals'}>← Referrals</Link><ResourceState resource={resource} />
    <Notice error={action.error} message={action.message} />
    {data && <><Heading title={data.name || 'Referral'} description={data.title} />
      <p className="pill">{labels[data.item.status]}</p>
      <div className="quick-actions">
        <Link to={home + '/candidate/' + data.item.run + '/' + data.item.candidate}>View candidate profile</Link>
        {data.manager && ['approved', 'submitted', 'completed'].includes(data.item.status) &&
          <a className="button secondary" href={'/api' + path + '/export'}>Export referral application</a>}
        {data.actions.map(status => <button className="button secondary" key={status} disabled={action.busy}
          onClick={() => setDecision(status)}>{decisionLabels[status]}</button>)}
      </div>
      {decision && <form className="panel form" onSubmit={async event => {
        event.preventDefault();
        const comment = new FormData(event.currentTarget).get('comment');
        if (await action.run(() => api(path + '/status', { method: 'POST', body: { status: decision, comment, confirmed: true } }))) {
          setDecision(''); setRevision(value => value + 1);
        }
      }}>
        <h2>Confirm {decisionLabels[decision].toLowerCase()}</h2>
        {decision === 'submitted' && <p>Confirm only after the referral has actually been submitted by an authorized person.</p>}
        <Field label="Comment (optional)"><input name="comment" maxLength={1000} /></Field>
        <div className="quick-actions"><button type="button" className="button secondary" onClick={() => setDecision('')}>Cancel</button>
          <button className="button primary" disabled={action.busy}>Confirm</button></div>
      </form>}
      <section className="panel"><h2>Status history</h2><ol className="resume-evidence">{data.item.history.map(event =>
        <li key={event._id}><strong>{labels[event.status]}</strong> · {date(event.at)}{event.comment && <p>{event.comment}</p>}</li>)}</ol></section>
    </>}
  </>;
}

export function Notifications() {
  const { base, home } = useReferrals();
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const resource = useResource(base + '/notifications?page=' + page, revision);
  const action = useAction();
  async function update(path, method, body) {
    await action.run(async () => {
      await api(base + '/notifications' + path, { method, body });
      setRevision(value => value + 1);
      window.dispatchEvent(new Event('refraa-notification-read'));
    });
  }
  return <><Heading title="Notifications" /><ResourceState resource={resource} /><Notice error={action.error} />
    {resource.data && <><label className="job-check"><input type="checkbox" checked={resource.data.email} disabled={action.busy}
      onChange={e => update('/preferences', 'PUT', { email: e.target.checked })} /> Email me workspace updates</label>
      <p>{resource.data.unread} unread</p><ul className="job-list">{resource.data.items.map(row => <li className="panel resume-row" key={row._id}>
        <div><Link to={home + row.path}>{row.message}</Link><p className="muted">{date(row.createdAt)} · Email {row.delivery}</p></div>
        {!row.readAt && <button className="button secondary" disabled={action.busy} onClick={() => update('/' + row._id + '/read', 'POST', {})}>Mark read</button>}
      </li>)}</ul>{!resource.data.items.length && <p className="panel muted">No updates yet.</p>}
      <Pages page={page} pages={resource.data.pages} change={setPage} /></>}
  </>;
}

export function Analytics() {
  const { base } = useReferrals();
  const [query, setQuery] = useState('');
  const resource = useResource(base + '/analytics?' + query);
  const [page, setPage] = useState(1);
  const jobs = useResource(base + '/opportunities?page=' + page);
  const data = resource.data;
  return <><Heading title="Recruitment analytics" description="Metrics for the selected creation dates (UTC)." />
    <form className="job-filters" onSubmit={event => {
      event.preventDefault();
      setQuery(new URLSearchParams([...new FormData(event.currentTarget)].filter(([, value]) => value)).toString());
    }}>
      <Field label="From"><input type="date" name="from" /></Field><Field label="To"><input type="date" name="to" /></Field>
      <Field label="Job"><select name="job"><option value="">All jobs</option>{jobs.data?.jobs.map(job =>
        <option value={job._id} key={job._id}>{job.title}</option>)}</select></Field><button className="button secondary">Apply filters</button>
    </form><Pages page={page} pages={jobs.data?.pages} change={setPage} /><ResourceState resource={resource} />
    {data && <><div className="quick-actions"><a href={'/api' + base + '/analytics?' + (query ? query + '&' : '') + 'format=csv'}>Export report</a></div>
      <div className="recruiting-metrics">{[['Resumes uploaded', data.resumes], ['Candidates processed', data.candidates],
        ['Active jobs', data.jobs], ['Matching runs', data.runs], ['Shortlisted candidates', data.shortlisted], ['Referral requests', data.requests],
        ['Referral conversion', data.conversion == null ? '—' : (data.conversion * 100).toFixed(1) + '%']].map(([label, value]) =>
        <div className="panel" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <div className="job-summary"><section className="panel"><h2>Status distribution</h2>{Object.entries(data.distribution).map(([key, value]) =>
        <label className="analytics-bar" key={key}>{labels[key]} · {value}<meter max={Math.max(1, ...Object.values(data.distribution))} value={value} /></label>)}</section>
        <section className="panel"><h2>Job performance</h2>{data.byJob.length ? data.byJob.map(row =>
          <p key={row._id}>{row.title || 'Unknown job'} · {row.completed} completed out of {row.requests} records</p>) : <p>No referral records.</p>}</section>
        <section className="panel"><h2>Referral trend</h2>{data.trend.length > 1 ? data.trend.map(row =>
          <label className="analytics-bar" key={row._id}>{row._id} · {row.count}<meter max={Math.max(...data.trend.map(item => item.count))} value={row.count} /></label>) : <p>More activity is needed to show a trend.</p>}</section>
        <section className="panel"><h2>Recent referral activity</h2>{data.recent.length ? data.recent.map(row =>
          <p key={row._id}>{labels[row.status]} · {date(row.updatedAt)}</p>) : <p>No recent activity.</p>}</section></div>
    </>}
  </>;
}
