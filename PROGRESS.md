# refraaAI Development Progress

## Phase 1 — Authentication and Company Onboarding

Implemented the React and Tailwind frontend, Express API, and Mongoose persistence. Automated checks verified the onboarding workflow against MongoDB and Chrome using a test mail capture.

## Implemented

- Work email registration, bcrypt password hashing, single-use email OTP, resend cooldown, attempt limits, and SMTP delivery with explicit configuration and delivery errors.
- CSRF protection, HTTP-only cookies with Secure enabled for HTTPS, persistent sessions, login, logout, protected routes, and single-use password recovery that invalidates prior sessions.
- A 100-company seed across four industries, search and pagination, industry filters, profile pages, duplicate detection, and pending submissions. Optional profile fields are populated for selected entries with source information.
- Pending membership requests, approved email domain verification, email invitations, company administrator review, and server-enforced organization isolation.
- Employee / Referrer, Recruiter, Company Admin, and Super Admin roles with operator-only administrator grants and dashboards.
- Environment examples, operator instructions, and a Dockerfile.

## Verification

| Check | Result |
| --- | --- |
| ESLint | PASS |
| Production frontend build | PASS |
| Unit tests | PASS — 6 tests |
| MongoDB and Chrome integration | PASS — 4 tests, including registration through dashboard and cross-organization denial |
| Production npm audit | PASS — zero reported vulnerabilities |
| Delivery through a live SMTP provider | BLOCKED — provider credentials and a deliverable work mailbox were unavailable |
| Docker image build | BLOCKED — the local Docker daemon was unavailable |

## Before Production Sign-off

- Configure SMTP and verify that OTP, reset, and invitation messages reach a real mailbox.
- Seed the target database, verify the first company's identity and work domains, and activate it with an operator-approved administrator.
- Build the Docker image in an environment with a working daemon if deploying with Docker.

## Phase 2 — Recruiter Dashboard and Job Management

- Added an organization-scoped recruiting overview with six database counters, recent jobs, job activity, and navigation. Resume, matching, and referral sections show counts and availability.
- Added a seven-step wizard, explicit drafts, publishing, job details, editing, and confirmed archiving. Job lists support title, status, and department filters with pagination. Recruiters and Company Admins can manage jobs in their own organization.
- Job edits preserve disabled Experience and CGPA values. The shared scoring configuration excludes disabled settings from eligibility and weights, and active weights sum to 10,000 basis points (100%).
- Resume ingestion, resume-based AI matching, and referral processing remain future work.

### Phase 2 verification

| Check | Result |
| --- | --- |
| ESLint and production frontend build | PASS |
| Unit tests | PASS — 8 tests, including all four toggle combinations |
| MongoDB and Chrome integration | PASS — 6 tests, including Phase 1 regressions, organization isolation, and the recruiter workflow from sign-in through archive |
| Docker image build | BLOCKED — local Docker daemon unavailable |

The browser test verifies both criteria can be disabled and published after a draft reload. The API test verifies their stored values survive and that the disabled criteria do not enter the scoring configuration.

## Phases 3–5 — Resume processing, matching, and referrals

- Phase 3 adds private PDF and DOCX storage, asynchronous extraction, batch tracking, and candidate profiles. The real-service regression verified a 1,000-file upload batch and the Chrome upload-to-profile flow.
- Phase 4 adds FastAPI embeddings, evidence-based scoring, eligibility, ranking, and run history. The regression verified a 1,000-candidate input and reranking with a changed shortlist count using Sentence Transformers.
- Phase 5 adds authorized candidate views, employee opportunities, referral requests and human review, confirmed submission tracking, CSV exports, notifications, and organization analytics.
- ESLint, production frontend build, and all 18 unit tests passed. The full local integration run passed all 10 tests with MongoDB, Redis, S3-compatible storage, Chrome, and FastAPI. Live SMTP delivery and optional Atlas search were not exercised. The notification integration test verifies handling of provider rejection with a test double.
- Phase 6 verified the core workflows locally using the bounded runner. Lint, build, 18 unit tests and 11 integration tests passed. Five audit findings were addressed and production sign-off remains partial because Docker and target infrastructure checks are open. See [the engineering audit](database/loop_engineering_report.md).

## Final end-to-end verification — 2026-11-13 IST

- Started the Vite frontend, Express API, MongoDB, Redis, S3-compatible storage, all three workers, and FastAPI with the cached Sentence Transformers model on disposable local infrastructure. Vite, the proxied API readiness check, and the AI health check returned HTTP 200.
- Verified registration, OTP handling, login, password reset, and company onboarding with captured test mail. A separate call through the real registration endpoint returned HTTP 503 `EMAIL_NOT_CONFIGURED`. Live OTP and notification email delivery are blocked by missing SMTP configuration and a test mailbox.
- Verified job editing with Experience and CGPA switches, real PDF and DOCX parsing through the queue, real inference and Top 3/Top 5 ranking, referral approval, in-app notifications, and analytics. Fixed the dashboard shortlist metric to count distinct existing candidates from completed runs and legacy shortlist records. The final run checks the count and stable ranking across reruns.
- Dependency consistency, lint, production build, 18 unit tests, and 11 integration tests passed without skips. The production npm advisory scan passed. Docker image builds are blocked by the missing daemon. Target storage policy, ClamAV, optional Atlas, and live SMTP remain unverified.
- Final runner evidence is in `database/verification_runs/2026-11-12T23-17-31-831Z.json` (UTC filename). See [Windows local startup commands](README.md#local-setup) and [production sign-off blockers](database/unresolved_errors/ENV-001.md).
