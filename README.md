# refraaAI

refraaAI includes work email authentication, a company directory, verified organization membership, and role-based dashboards. Recruiters and company administrators can create and manage jobs.

## Local setup

1. Use Node.js 24 LTS and a MongoDB instance. Install dependencies with `npm ci`.
2. Copy `.env.example` to `.env`. Set `MONGODB_URI`, `APP_ORIGIN`, and a generated `AUTH_SECRET`. Configure an authenticated SMTP provider with `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `MAIL_FROM`. Use a sender your provider authorizes. The application reports missing credentials and rejected delivery.
3. Run `npm run seed`. This inserts 100 listings without granting access to any organization.
4. Run `npm run dev:api` and `npm run dev` in separate terminals. Open `http://localhost:5173`. The development proxy forwards same-origin API requests to port 3000.
5. Register and verify a work email. Email verification requires the registration password to prevent someone from activating an account another person registered in their name. If needed, use password recovery before verifying the address.

For the complete local stack on Windows, start MongoDB, Redis, and private S3-compatible storage first. Use `APP_ORIGIN=http://localhost:5173`, `PORT=3000`, and `MATCH_AI_URL=http://127.0.0.1:8000` in `.env`. For an empty local database:

```powershell
npm.cmd ci
Copy-Item .env.example .env # Run only if .env does not exist
# Fill in .env before running the next command.
npm.cmd run seed
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --index-url https://download.pytorch.org/whl/cpu "torch>=2.6"
.\.venv\Scripts\python.exe -m pip install -r ai/requirements.txt
```

Run these in separate PowerShell terminals from the project root. The first command loads the root `.env` in a temporary Node process and passes its environment to Uvicorn without printing credentials.

```powershell
node --env-file=.env -e "const {spawnSync}=require('node:child_process');const r=spawnSync('./.venv/Scripts/python.exe',['-m','uvicorn','app:app','--app-dir','ai','--host','127.0.0.1','--port','8000','--no-access-log'],{stdio:'inherit'});process.exitCode=r.status??1"
npm.cmd run dev:api
npm.cmd run dev
npm.cmd run worker:resumes
npm.cmd run worker:matching
npm.cmd run worker:notifications
```

## Organization setup

A trusted service operator verifies the company and its email domains outside the application before activating an organization. Directory websites never count as approved email domains. First register and verify the intended administrator's account, then run:

```sh
npm run org:configure -- activate "Company name" admin@company.example company.example
npm run org:configure -- super-admin operator@company.example
```

The activation command replaces the organization's approved domain list with the domains supplied. Omitting domains leaves verification available by email invitation or administrator review. Only a trusted operator with database credentials can grant Company Admin or Super Admin. Company administrators can approve a member as an employee or recruiter, decline a request, or send an invitation to a specific work email. A verified domain grants employee access. Recruiter access requires an explicit grant, and a recruiter may also choose the employee role. A platform administrator needs separate verified membership to access a tenant dashboard.

Seed entries use company names, industries, and official site references. Profiles show headquarters, descriptions, logo images, and careers links when those details are available in the seed. The directory uses initials when a logo is unavailable.

## Recruiter dashboard and jobs

Sign in with a verified Recruiter or Company Admin membership and open the company workspace. Use **Start New Screening** to create a job, save a draft, or review and publish it. Jobs are private to the organization. Archived jobs remain available in the job list and detail view.

Experience and CGPA switches retain their saved inputs. The job detail API returns active weights in basis points and includes eligibility settings only for enabled criteria. Phase 2 does not process resumes or rank candidates.

Dashboard counters use organization-scoped records. The shortlist counter counts distinct existing candidates from completed runs or legacy shortlist records. Candidate records count as processed with status `processed` or `shortlisted`. Referral counters use `pending_review` (or legacy `pending_approval`) and `completed`. Collections with no matching records return zero.

## Production build

### Resume pipeline setup

1. Configure the `RESUME_*` variables in `.env.example`. Use a private S3-compatible bucket with public access blocked and scoped permissions for the `resumes/` prefix. Configure bucket encryption and, if versioning is enabled, a lifecycle rule to expire noncurrent versions and incomplete multipart uploads. Use an HTTPS storage endpoint in production.
2. Provide Redis with persistence and `maxmemory-policy noeviction`. Use a separate queue name for each environment. The API and worker use the same MongoDB, Redis, and storage configuration.
3. Start the API and run `npm run worker:resumes` as a separate process. For Docker use the same image with `node server/resumes/worker.js` as its command. Size API memory for the configured number and maximum size of concurrent file uploads.
4. For ClamAV, set `RESUME_CLAMAV_HOST` and optionally `RESUME_REQUIRE_SCAN=true`. Match the scanner stream limit to the maximum file size. Keep the scanner on a private network.

Recruiters and Company Admins can upload in **Resume Library**. The uploader can retry unfinished uploads for 24 hours by reselecting the original files. Stored files continue processing after navigation, cancellation of remaining uploads, or worker restarts. Only Company Admins can request deletion. Set a retention period where required. No OCR engine is bundled, so PDFs without readable text are marked for OCR. Extraction uses document text and explicit source lines. Candidate version linking is manual and keeps earlier files and profiles.

Use dedicated, disposable Redis and S3 services when running resume integration tests. Set the normal `RESUME_*` variables alongside `TEST_MONGODB_URI`. The tests upload synthetic fixture documents and exercise administrative deletion on those fixtures.

### Matching, referrals, and notifications

Run the private FastAPI service from `ai/` with `uvicorn app:app --no-access-log` and a shared `MATCH_AI_TOKEN`. Configure its origin in `MATCH_AI_URL`, then start `npm run worker:matching` alongside the existing resume worker. The embedding model can be cached locally. If enabling Atlas project search, configure the index on `matchingvectors.embedding` with the model's dimensions and filter fields `organization`, `run`, and `attempt`.

Run `npm run worker:notifications` with the API's MongoDB, app origin, and SMTP configuration. The worker reconciles durable status changes into in-app updates. Users can opt into email per organization. Delivery status `accepted` means the configured SMTP server accepted the recipient. An email send can repeat after an interruption between provider acceptance and saving the result.

Published jobs expose shortlisted recommendations to verified employees in the organization. Recruiting roles can view contact details and originals. Independent review is the default and remains required for requests created under that policy. Recruiters record submission after it occurs. Application and analytics exports use CSV.

### Build and serve

Use `/api/health` for process liveness and `/api/ready` for MongoDB readiness. The AI service serves `/health` after model startup. Verify the workers and their Redis, storage, and SMTP integrations separately before promoting a release.

Run `npm run build` and `npm start` from the project root, or build the supplied Dockerfile. Express serves the frontend and API from one origin. In production use the public HTTPS origin for `APP_ORIGIN`. Set `TRUST_PROXY_HOPS` only for a known proxy topology with sanitized forwarding headers. Supply secrets through the runtime environment and use an authenticated MongoDB deployment. Run the seed and operator commands with credentials authorized for those tasks.

## Verification

Run `npm run lint`, `npm run build`, and `npm test`. For database tests, set `TEST_MONGODB_URI` to a dedicated test MongoDB instance and run `npm run test:integration`. Each invocation creates a uniquely named test database and retains it for inspection. To include the browser workflow, set `BROWSER_CHANNEL=chrome` or `BROWSER_EXECUTABLE` to an installed Chromium browser. The automated tests capture email content in memory and check missing SMTP configuration independently. A live provider test requires valid SMTP credentials and a deliverable mailbox.

### Bounded release verification

Run `npm run verify` against disposable integration services. Configure `TEST_MONGODB_URI`, `BROWSER_CHANNEL` or `BROWSER_EXECUTABLE`, the resume test bucket and Redis, and the private FastAPI service. The integration suite creates synthetic data. Never point it at a production database, queue, or bucket.

The runner executes repository checks and writes a structured result under `database/verification_runs/`. Exit codes are 0 for pass, 1 for failures, and 2 for checks blocked by missing infrastructure or budget. Configure `VERIFY_ITERATIONS` (maximum 20), `VERIFY_ATTEMPTS` (maximum 5), `VERIFY_SECONDS`, and `VERIFY_CHECK_SECONDS`. It stops retrying a check when the failure repeats, and flags changes from the previous run. Use the engineering report to review and apply source fixes before rerunning. The script runs only when invoked.

Before release, build both Docker images, validate your target SMTP provider and private storage, and exercise the configured scanner and optional Atlas index. The integration suite's synthetic fixtures provide workflow coverage and elapsed times, not production capacity limits.
