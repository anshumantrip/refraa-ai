import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, uploadFile } from './api.js';
import { dateTime, useRecruitingWorkspace } from './recruiting.jsx';
import { Field, Heading, Notice, ResourceState, useAction, useResource } from './ui.jsx';

const statuses = {
  uploading: 'Uploading', upload_failed: 'Upload failed', pending: 'Pending', processing: 'Processing',
  parsed: 'Parsed', failed: 'Failed', ocr_required: 'OCR required', duplicate: 'Duplicate',
  deleting: 'Removing', deleted: 'Removed'
};
const countNames = { total: 'Total files', uploaded: 'Uploaded', pending: 'Pending', processing: 'Processing',
  parsed: 'Parsed', failed: 'Failed', duplicates: 'Duplicates', removed: 'Removed' };
const sizeLabel = bytes => bytes < 1024 ? bytes + ' B' :
  bytes < 1024 ** 2 ? (bytes / 1024).toFixed(1) + ' KB' : (bytes / 1024 ** 2).toFixed(1) + ' MB';

function Pager({ data, setPage }) {
  if (!data || data.pages <= 1) return null;
  return <nav className="pagination" aria-label="Results pages">
    <button className="button secondary" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>Previous</button>
    <span>Page {data.page} of {data.pages}</span>
    <button className="button secondary" disabled={data.page >= data.pages} onClick={() => setPage(data.page + 1)}>Next</button>
  </nav>;
}

export function ResumeLibrary() {
  const { home, apiBase } = useRecruitingWorkspace();
  const [params, setParams] = useSearchParams();
  const resource = useResource(apiBase + '/resumes?' + params);
  const data = resource.data;
  return <>
    <div className="recruiting-heading"><Heading title="Resume Library" description="Browse uploaded resumes and candidate profiles." />
      <Link className="button primary" to={home + '/resume-library/upload'}>Upload resumes</Link></div>
    <Link className="back-link" to={home + '/resume-library/batches'}>Batch history →</Link>
    <form className="filters" key={params.get('q') + ':' + params.get('status')} onSubmit={event => {
      event.preventDefault();
      const query = new URLSearchParams(new FormData(event.currentTarget));
      for (const [key, value] of [...query]) if (!value.trim()) query.delete(key);
      setParams(query);
    }}>
      <Field label="Filename"><input name="q" type="search" maxLength={100} defaultValue={params.get('q') || ''} /></Field>
      <Field label="Processing status"><select name="status" aria-label="Processing status" defaultValue={params.get('status') || ''}>
        <option value="">All current resumes</option>
        {Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></Field>
      <button className="button secondary">Filter</button>
    </form>
    <ResourceState resource={resource} />
    {data && (data.items.length ? <ul className="job-list">{data.items.map(item => <li key={item._id}>
      {item.parsingStatus === 'deleted' || item.parsingStatus === 'deleting' ?
        <div className="job-list-row"><span>{item.originalFilename}</span><span className="pill">{statuses[item.parsingStatus]}</span></div> :
        <Link className="job-list-row" to={home + '/resume-library/files/' + item._id}>
          <div><strong>{item.originalFilename}</strong><small>{sizeLabel(item.fileSize)}</small></div>
          <span className="pill">{statuses[item.parsingStatus]}</span><time>{dateTime(item.createdAt)}</time>
        </Link>}
    </li>)}</ul> : <p className="panel muted">No resumes match this view.</p>)}
    <Pager data={data} setPage={page => { const query = new URLSearchParams(params); query.set('page', page); setParams(query); }} />
  </>;
}

export function ResumeUpload() {
  const { apiBase, home } = useRecruitingWorkspace();
  const limits = useResource(apiBase + '/resumes/limits');
  const [jobPage, setJobPage] = useState(1);
  const jobs = useResource(apiBase + '/jobs?page=' + jobPage);
  const [job, setJob] = useState(null);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const action = useAction();
  const navigate = useNavigate();
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const limitsData = limits.data;

  function select(incoming) {
    if (!limitsData?.configured || action.busy) return;
    const selected = Array.from(incoming);
    const combined = [...files, ...selected];
    if (combined.length > limitsData.maxFiles) return setError('Select at most 1,000 files.');
    if (selected.some(file => !/\.(pdf|docx)$/i.test(file.name) || !file.size || file.size > limitsData.maxFile ||
        file.name.length > 180)) return setError('Choose nonempty PDF or DOCX files within the size and filename limits.');
    if (combined.reduce((sum, file) => sum + file.size, 0) > limitsData.maxBatch) return setError('The selection exceeds the batch size limit.');
    setError('');
    setFiles(combined);
  }

  return <>
    <Link className="back-link" to={home + '/resume-library'}>← Resume Library</Link>
    <Heading title="Upload resumes" description="Select up to 1,000 PDF or DOCX files. Processing runs in the background." />
    <ResourceState resource={limits} />
    {limitsData && !limitsData.configured && <Notice error="Resume storage or processing is not configured. Contact the service operator." />}
    <Notice error={error || action.error} />
    <form className="panel form" onSubmit={async event => {
      event.preventDefault();
      const batch = await action.run(() => api(apiBase + '/resumes/batches', { method: 'POST', body: {
        files: files.map(({ name, size }) => ({ name, size })), ...(job && { jobId: job._id })
      } }));
      if (batch) startUploads(apiBase, batch.id, files.map((file, slot) => [slot, file]));
      if (batch) navigate(home + '/resume-library/batches/' + batch.id);
    }}>
      <label className="resume-drop" onDragOver={event => event.preventDefault()} onDrop={event => {
        event.preventDefault(); select(event.dataTransfer.files);
      }}>
        <strong>Drop resumes here or browse files</strong>
        <span className="muted">PDF or DOCX{limitsData && ' · ' + sizeLabel(limitsData.maxFile) + ' per file · ' + sizeLabel(limitsData.maxBatch) + ' per batch'}</span>
        <input aria-label="Choose resumes" type="file" accept=".pdf,.docx" multiple disabled={!limitsData?.configured || action.busy}
          onChange={event => { select(event.target.files); event.target.value = ''; }} />
      </label>
      <div className="resume-row"><strong role="status">{files.length} selected · {sizeLabel(total)}</strong>
        {files.length > 0 && <button type="button" className="text-button" disabled={action.busy} onClick={() => { setFiles([]); setError(''); }}>Clear files</button>}</div>
      {files.length > 0 && <ul className="resume-file-list">{files.map((file, index) =>
        <li key={index}><span>{file.name} · {sizeLabel(file.size)}</span><button type="button" className="text-button"
          disabled={action.busy} aria-label={'Remove ' + file.name} onClick={() => setFiles(files.filter((_, slot) => slot !== index))}>Remove</button></li>)}</ul>}
      <Field label="Associate with a job"><select aria-label="Associate with a job" value={job?._id || ''}
        onChange={event => setJob(jobs.data?.items.find(item => item._id === event.target.value) || null)}>
        <option value="">No job</option>
        {job && !jobs.data?.items.some(item => item._id === job._id) && <option value={job._id}>{job.title}</option>}
        {jobs.data?.items.filter(item => item.status !== 'archived').map(item => <option value={item._id} key={item._id}>{item.title}</option>)}
      </select></Field>
      <ResourceState resource={jobs} /><Pager data={jobs.data} setPage={setJobPage} />
      <button className="button primary" disabled={!files.length || !limitsData?.configured || action.busy}>
        {action.busy ? 'Creating batch…' : 'Start upload'}</button>
    </form>
  </>;
}

// Active browser uploads live outside the route so navigation within the app does not abort them.
const transfers = new Map();
const retentionMs = 15 * 60_000;
const transferKey = (base, id) => base + '/' + id;

function startUploads(base, id, entries) {
  const key = transferKey(base, id);
  const current = transfers.get(key);
  if (current?.running) return;
  const transfer = { entries: new Map(current?.entries),
    controller: new AbortController(), running: true };
  for (const [slot, file] of entries) transfer.entries.set(slot, { file, loaded: 0 });
  transfers.set(key, transfer);
  let index = 0;
  async function lane() {
    while (index < entries.length && !transfer.controller.signal.aborted) {
      const [slot, file] = entries[index++];
      const entry = transfer.entries.get(slot);
      const url = base + '/resumes/batches/' + id + '/files/' + slot;
      try {
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            await uploadFile(url, file, transfer.controller.signal, loaded => { entry.loaded = loaded; });
            entry.loaded = file.size;
            entry.done = true;
            break;
          } catch (error) {
            if (attempt === 3 || !['UPLOAD_BUSY', 'UPLOAD_IN_PROGRESS'].includes(error.code)) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          }
        }
      } catch (error) { entry.error = error.message; }
    }
  }
  void Promise.all(Array.from({ length: Math.min(4, entries.length) }, lane)).finally(() => {
    transfer.running = false;
    setTimeout(() => { if (transfers.get(key) === transfer) transfers.delete(key); }, retentionMs);
  });
}

export function ResumeBatches() {
  const { home, apiBase } = useRecruitingWorkspace();
  const [page, setPage] = useState(1);
  const resource = useResource(apiBase + '/resumes/batches?page=' + page);
  return <>
    <Link className="back-link" to={home + '/resume-library'}>← Resume Library</Link>
    <Heading title="Batch history" />
    <ResourceState resource={resource} />
    {resource.data && (resource.data.items.length ? <ul className="job-list">{resource.data.items.map(item =>
      <li key={item._id}><Link className="job-list-row" to={home + '/resume-library/batches/' + item._id}>
        <strong>{dateTime(item.createdAt)}</strong><span>{sizeLabel(item.totalBytes)}</span><span>{item.cancelledAt ? 'Cancelled' : 'View batch'}</span>
      </Link></li>)}</ul> : <p className="panel muted">No upload batches yet.</p>)}
    <Pager data={resource.data} setPage={setPage} />
  </>;
}

export function ResumeBatch() {
  const { id, batchId } = useParams();
  return <ResumeBatchView key={id + ':' + batchId} batchId={batchId} />;
}

function ResumeBatchView({ batchId }) {
  const { home, apiBase, user, data } = useRecruitingWorkspace();
  const path = apiBase + '/resumes/batches/' + batchId;
  const [batch, setBatch] = useState(null);
  const [error, setError] = useState('');
  const [, setTick] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [filePage, setFilePage] = useState(1);
  const [retryFiles, setRetryFiles] = useState([]);
  const action = useAction();
  const filePicker = useRef(null);
  const transfer = transfers.get(transferKey(apiBase, batchId));
  const running = Boolean(transfer?.running);
  const processing = !batch || batch.counts.progress < 100 || running;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setTick(value => value + 1);
      if (!transfers.get(transferKey(apiBase, batchId))?.running) clearInterval(timer);
    }, 200);
    return () => clearInterval(timer);
  }, [running, apiBase, batchId]);
  useEffect(() => {
    const controller = new AbortController();
    let timer;
    async function load() {
      try {
        const next = await api(path, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setBatch(next); setError('');
        if (next.counts.progress < 100 || transfers.get(transferKey(apiBase, batchId))?.running) {
          timer = setTimeout(load, 2500);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setError(error.message);
        if (!error.status || error.status >= 500) timer = setTimeout(load, 5000);
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [path, refresh, apiBase, batchId]);
  const open = batch && !batch.cancelledAt && Date.parse(batch.expiresAt) > Date.now();
  const owner = batch?.createdBy === user.id;
  const canCancel = owner || data.membership.role === 'company_admin';
  const totalLoaded = batch?.files.reduce((sum, row) => {
    if (row.parsingStatus && !['uploading', 'upload_failed'].includes(row.parsingStatus)) return sum + row.size;
    return sum + Math.min(row.size, transfer?.entries.get(row.slot)?.loaded || 0);
  }, 0);
  const readyToRetry = open && owner && !running;
  function retryUpload(row) {
    const local = transfer?.entries.get(row.slot)?.file || retryFiles.find(file => file.name.normalize('NFKC') === row.name && file.size === row.size);
    if (local) {
      startUploads(apiBase, batchId, [[row.slot, local]]);
      setRefresh(value => value + 1);
    } else { setError('Select the original file, then retry this row.'); filePicker.current?.click(); }
  }
  async function retryProcessing(row) {
    const result = await action.run(() => api(apiBase + '/resumes/' + row._id + '/retry', { method: 'POST', body: {} }));
    if (result) setRefresh(value => value + 1);
  }
  return <>
    <Link className="back-link" to={home + '/resume-library/batches'}>← Batch history</Link>
    <Heading title="Upload batch" description={batch && dateTime(batch.createdAt)} />
    <Notice error={action.error || error} />
    {!batch && !error && <p role="status" className="panel">Loading batch…</p>}
    {batch && <>
      <div className="panel resume-progress">
        <label>Upload progress <progress max={batch.totalBytes} value={totalLoaded} /></label>
        <label>Processing completion · {batch.counts.progress}% <progress max={100} value={batch.counts.progress} /></label>
        {batch.cancelledAt && <p className="muted">Uploads cancelled. Stored resumes continue processing.</p>}
        <div className="resume-counts">{Object.entries(countNames).map(([key, label]) =>
          <div key={key}><small>{label}</small><strong>{batch.counts[key]}</strong></div>)}</div>
        {open && canCancel && (running || batch.files.some(row => !row.parsingStatus || ['uploading', 'upload_failed'].includes(row.parsingStatus))) &&
          <button className="button secondary" disabled={action.busy} onClick={async () => {
            await action.run(async () => {
              await api(path + '/cancel', { method: 'POST', body: {} });
              transfer?.controller.abort();
              setRefresh(value => value + 1);
            });
          }}>Cancel uploads</button>}
      </div>
      <div className="resume-row resume-batch-actions">
        <Link to={home + '/resume-library'}>Open Resume Library</Link>
        {batch.job && <Link to={home + '/jobs/' + batch.job}>View associated job</Link>}
        {!processing && <button className="button secondary" onClick={() => setRefresh(value => value + 1)}>Refresh status</button>}
        {readyToRetry && <input ref={filePicker} aria-label="Select original files for retry" type="file" multiple accept=".pdf,.docx"
          onChange={event => { setRetryFiles(Array.from(event.target.files)); setError(''); }} />}
        {readyToRetry && transfer && <button className="button secondary" onClick={() => {
          const entries = batch.files.flatMap(row => {
            const previous = transfer.entries.get(row.slot);
            return previous?.error && (!row.parsingStatus || row.parsingStatus === 'upload_failed') ? [[row.slot, previous.file]] : [];
          });
          if (entries.length) { startUploads(apiBase, batchId, entries); setRefresh(value => value + 1); }
          else setError('No failed files from the current transfer are available to retry.');
        }}>Retry failed uploads</button>}
      </div>
      <ul className="job-list">{batch.files.slice((filePage - 1) * 25, filePage * 25).map(row => {
        const local = transfer?.entries.get(row.slot);
        const label = statuses[row.parsingStatus] || (local?.error ? 'Upload failed' : local?.done ? 'Uploaded' : open ? 'Waiting for upload' : 'Upload closed');
        return <li className="panel resume-file-row" key={row.slot}>
          <div>{row._id && !['deleting', 'deleted'].includes(row.parsingStatus) ?
            <Link to={home + '/resume-library/files/' + row._id}>{row.originalFilename || row.name}</Link> : <strong>{row.name}</strong>}
            <small className="muted">{label} · {sizeLabel(row.size)}</small>
            {(row.errorDetails || local?.error) && <small role="status">{row.errorDetails || local.error}</small>}
            {local && !local.done && !local.error && <progress aria-label={'Upload progress for ' + row.name} max={row.size} value={local.loaded} />}
          </div>
          {row.parsingStatus === 'failed' && <button className="button secondary" disabled={action.busy} onClick={() => retryProcessing(row)}>Retry processing</button>}
          {readyToRetry && (!row.parsingStatus || row.parsingStatus === 'upload_failed') &&
            <button className="button secondary" onClick={() => retryUpload(row)}>Retry upload</button>}
        </li>;
      })}</ul>
      <Pager data={{ page: filePage, pages: Math.ceil(batch.files.length / 25) }} setPage={setFilePage} />
    </>}
  </>;
}

const profileFields = [['Education', 'education'], ['Skills', 'skills'], ['Experience', 'experience'], ['Internships', 'internships'],
  ['Projects', 'projects'], ['Certifications', 'certifications']];

export function ResumeDetail() {
  const { home, apiBase, data } = useRecruitingWorkspace();
  const { resumeId } = useParams();
  const path = apiBase + '/resumes/' + resumeId;
  const [revision, setRevision] = useState(0);
  const resource = useResource(path, revision);
  const action = useAction();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const item = resource.data?.item;
  const profile = resource.data?.profile;
  const terminal = item && ['parsed', 'failed', 'ocr_required'].includes(item.parsingStatus);
  async function perform(suffix, body) {
    await action.run(async () => {
      await api(path + suffix, { method: 'POST', body });
      setRevision(value => value + 1);
    });
  }
  return <>
    <Link className="back-link" to={home + '/resume-library'}>← Resume Library</Link>
    <ResourceState resource={resource} />
    <Notice error={action.error} />
    {item && <>
      <div className="recruiting-heading"><Heading title={item.originalFilename} description={statuses[item.parsingStatus]} />
        {terminal && item.scanPassed && <a className="button primary" href={'/api' + path + '/original'} download>Download original</a>}</div>
      <div className="quick-actions">
        <Link to={home + '/resume-library/batches/' + item.batch}>View batch</Link>
        {item.job && <Link to={home + '/jobs/' + item.job}>View associated job</Link>}
        {item.parsingStatus === 'failed' && <button className="button secondary" disabled={action.busy} onClick={() => perform('/retry', {})}>Retry processing</button>}
        {item.parsingStatus === 'duplicate' && !item.exactReview && <button className="button secondary" disabled={action.busy}
          onClick={() => perform('/review', { action: 'dismiss_exact' })}>Mark duplicate reviewed</button>}
        {data.membership.role === 'company_admin' && (terminal || ['duplicate', 'upload_failed'].includes(item.parsingStatus)) &&
          <button className="button secondary" onClick={() => setConfirm(true)}>Delete resume</button>}
      </div>
      {confirm && <div className="panel archive-confirmation"><h2>Delete this resume and its extracted profile?</h2>
        <div><button className="button secondary" disabled={action.busy} onClick={() => setConfirm(false)}>Keep resume</button>
          <button className="button primary" disabled={action.busy} onClick={async () => {
            const result = await action.run(() => api(path, { method: 'DELETE' }));
            if (result) navigate(home + '/resume-library');
          }}>Confirm deletion</button></div></div>}
      <Notice error={item.errorDetails} />
      {item.parsingStatus === 'duplicate' && <div className="panel"><p>This file matches an existing upload. {item.exactReview && 'Reviewed.'}</p>
        {item.duplicateOf && <Link to={home + '/resume-library/files/' + item.duplicateOf}>View matching resume</Link>}</div>}
      {profile && <div className="job-summary">
        <section className="panel job-summary-section"><h2>Candidate profile</h2><dl>
          <div><dt>Name</dt><dd>{profile.name || 'Unknown'}</dd></div>
          <div><dt>Email</dt><dd>{profile.email || 'Unknown'}</dd></div>
          <div><dt>Phone</dt><dd>{profile.phone || 'Unknown'}</dd></div>
        </dl>
        {profile.versionOf && <p><Link to={home + '/resume-library/files/' + profile.versionOf}>View earlier resume version</Link></p>}</section>
        {resource.data.potentialDuplicates.length > 0 && <section className="panel"><h2>Potential duplicates</h2>
          <p className="muted">These profiles share an email or phone number. Review them before linking versions.</p>
          <ul className="resume-file-list">{resource.data.potentialDuplicates.map(candidate => <li key={candidate._id}>
            <Link to={home + '/resume-library/files/' + candidate.resumeIds[0]}>{candidate.name || candidate.email || candidate.phone}</Link>
            {(candidate.createdAt < profile.createdAt || (candidate.createdAt === profile.createdAt && candidate._id < profile._id)) &&
              <button className="button secondary" disabled={action.busy}
              onClick={() => perform('/review', { action: 'link_version', candidateId: candidate._id })}>Link as earlier version</button>}
          </li>)}</ul>
          <button className="button secondary" disabled={action.busy} onClick={() => perform('/review', { action: 'distinct' })}>Keep as distinct candidate</button>
        </section>}
        {profileFields.map(([label, key]) => <section className="panel job-summary-section" key={key}><h2>{label}</h2>
          {profile[key].length ? <ul className="resume-evidence">{profile[key].map((value, index) => {
            const evidence = item.extractionEvidence?.[key]?.[index];
            return <li key={index}>{typeof value === 'string' ? value : value.text}
              {evidence && <details><summary>Evidence · line {evidence.line}</summary><p>{evidence.excerpt}</p></details>}</li>;
          })}</ul> : <p className="muted">No information extracted.</p>}
        </section>)}
      </div>}
    </>}
  </>;
}
