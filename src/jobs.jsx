import { useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { jobStatuses } from '../shared/jobs.js';
import { api } from './api.js';
import { dateTime, JobStatus, jobStatusLabel, useRecruitingWorkspace } from './recruiting.jsx';
import { Field, Heading, Notice, ResourceState, useAction, useResource } from './ui.jsx';
import { JobSummary } from './job-summary.jsx';

export function Jobs() {
  const { home, apiBase } = useRecruitingWorkspace();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const status = params.get('status') || '';
  const department = params.get('department') || '';
  const page = Number(params.get('page')) || 1;
  const query = new URLSearchParams({ q, department, page: String(page), ...(status && { status }) });
  const resource = useResource(apiBase + '/jobs?' + query);
  const data = resource.data;
  const departments = data?.departments || [];
  return <>
    <div className="recruiting-heading">
      <Heading title="Jobs" description="Create roles, manage drafts, and review screening requirements." />
      <Link className="button primary" to={home + '/jobs/new'}>Create job</Link>
    </div>
    <form className="job-filters" key={JSON.stringify([q, status, department])} onSubmit={event => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      const next = new URLSearchParams();
      for (const key of ['q', 'status', 'department']) {
        const value = values.get(key).trim();
        if (value) next.set(key, value);
      }
      setParams(next);
    }}>
      <Field label="Job title"><input type="search" name="q" placeholder="Search job titles" maxLength={120} defaultValue={q} /></Field>
      <Field label="Status"><select name="status" defaultValue={status}><option value="">All statuses</option>
        {jobStatuses.map(value => <option key={value} value={value}>{jobStatusLabel[value]}</option>)}</select></Field>
      <Field label="Department"><input name="department" defaultValue={department} list="job-departments"
        placeholder="All departments" maxLength={120} /></Field>
      <datalist id="job-departments">{departments.map(value => <option value={value} key={value} />)}</datalist>
      <button className="button secondary" type="submit">Filter jobs</button>
    </form>
    <ResourceState resource={resource} />
    {data && <>
      <p className="result-count" role="status">{data.total} {data.total === 1 ? 'job' : 'jobs'}</p>
      {data.items.length ? <ul className="job-list">{data.items.map(item =>
        <li key={item._id}><Link className="job-list-row" to={home + '/jobs/' + item._id}>
          <div><strong>{item.title}</strong><small>{[item.department, item.location, item.employmentType].filter(Boolean).join(' · ') || 'No job details specified'}</small></div>
          <JobStatus status={item.status} /><time dateTime={item.updatedAt}>{dateTime(item.updatedAt)}</time>
        </Link></li>)}</ul> : <div className="panel muted">{q || status || department ?
          'No jobs match these filters.' : 'No jobs yet. Create a job to get started.'}</div>}
      {data.pages > 1 && <nav className="pagination" aria-label="Job pages">
        <button className="button secondary" type="button" disabled={page <= 1}
          onClick={() => { query.set('page', String(page - 1)); setParams(query); }}>Previous</button>
        <span>Page {page} of {data.pages}</span>
        <button className="button secondary" type="button" disabled={page >= data.pages}
          onClick={() => { query.set('page', String(page + 1)); setParams(query); }}>Next</button>
      </nav>}
    </>}
  </>;
}

export function JobDetail() {
  const { home, apiBase } = useRecruitingWorkspace();
  const { jobId } = useParams();
  const { state } = useLocation();
  const [revision, setRevision] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const resource = useResource(apiBase + '/jobs/' + jobId, revision);
  const action = useAction();
  const job = resource.data?.item;

  async function archive() {
    const result = await action.run(() => api(apiBase + '/jobs/' + jobId + '/archive',
      { method: 'POST', body: { revision: job.revision } }));
    if (result) { setConfirming(false); setRevision(value => value + 1); }
  }

  return <>
    <Link className="back-link" to={home + '/jobs'}>← Jobs</Link>
    <ResourceState resource={resource} />
    {job && <>
      <div className="recruiting-heading">
        <Heading title={job.title} description={[job.department, job.location, job.employmentType].filter(Boolean).join(' · ')} />
        <div className="job-detail-actions"><JobStatus status={job.status} />
          {job.status !== 'archived' && <>
            <Link className="button primary" to={home + '/jobs/' + jobId + '/edit'}>Edit job</Link>
            <button className="button secondary" type="button" disabled={confirming} onClick={() => setConfirming(true)}>Archive job</button>
          </>}
        </div>
      </div>
      <Notice error={action.error} message={action.message || state?.message} />
      {confirming && <section className="panel archive-confirmation" aria-labelledby="archive-heading">
        <h2 id="archive-heading">Archive this job?</h2>
        <p className="muted">Archived jobs stay in the job history and can no longer be edited.</p>
        <div><button className="button secondary" type="button" disabled={action.busy} onClick={() => setConfirming(false)}>Cancel</button>
          <button className="button primary" type="button" disabled={action.busy} onClick={archive}>
            {action.busy ? 'Archiving…' : 'Confirm archive'}</button></div>
      </section>}
      <JobSummary job={job} />
    </>}
  </>;
}
