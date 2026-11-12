# AGENTS.md — refraaAI Engineering Rules

## Project

Build a production-ready, AI-powered employee referral and resume intelligence SaaS platform. The product requirements are maintained in [`docs/requirements.md`](docs/requirements.md); current development status is tracked in [`PROGRESS.md`](PROGRESS.md).

## Technology Stack

- Frontend: React and Tailwind CSS
- Backend: Node.js and Express
- Database: MongoDB
- AI services: Python, FastAPI, and Sentence Transformers
- Background jobs: Redis and BullMQ
- File storage: S3-compatible object storage
- Deployment: Docker

Follow the repository’s established architecture and conventions when they exist. Do not introduce a competing framework or service without a requirement-driven reason.

## Working Rules

1. Inspect existing code and relevant documentation before editing.
2. Reuse working components, APIs, and established patterns.
3. Implement functional features; do not substitute mock-only interfaces for required behavior.
4. Follow existing architecture and conventions.
5. Keep changes minimal and targeted to the requested work.
6. Never hardcode secrets or credentials. Use the project’s approved configuration and secret-management approach.
7. Preserve existing features and uncommitted changes.
8. Never claim untested functionality works; report what was and was not verified.
9. Ask the user only when blocked by an essential decision that cannot be resolved from the repository or requirements.
10. Avoid unnecessary explanations and repeated code output.
11. Do not modify application code when the task asks only for documentation or planning.

## Development Workflow

For each implementation task:

1. Read relevant requirements and current progress.
2. Inspect affected modules and their callers.
3. Implement the requested feature.
4. Run relevant lint, build, and test checks.
5. Fix detected issues without introducing regressions.
6. Update `PROGRESS.md` with the work and verification status.
7. Report changes, test results, and blockers concisely.


## Product-Critical Rules

- Authentication must be secure and include email OTP verification.
- Organization membership must be verified, with role-based access control.
- Enforce tenant-level data isolation across reads, writes, background jobs, and AI processing.
- Bulk resume processing must be asynchronous.
- AI candidate matching must be evidence-based and traceable to resume or role evidence.
- Experience and CGPA ON/OFF settings must affect actual candidate scoring.
- Active scoring weights must total exactly 100%.
- Top N results must contain only suitable candidates; do not fill the list with unsuitable candidates to reach N.
- A human must approve a referral before it is submitted or finalized.
- Never fabricate candidate information. Represent missing or uncertain information as unknown and preserve its provenance.

## Security and Data Handling

- Apply authorization and tenant scoping server-side; frontend visibility is not an access control.
- Validate and normalize user input at trust boundaries.
- Treat resumes and other uploaded files as untrusted input. Enforce appropriate file type and size controls and avoid executing uploaded content.
- Keep sensitive personal data and credentials out of logs, error responses, fixtures, and source control.
- Use least-privilege access for services and storage.
- Preserve source evidence for AI-derived claims and make uncertainty visible.

## Verification and Operations

- Do not disable tests or suppress errors to obtain a passing result.
- Retry resolvable verification failures up to five times; then document the blocker and continue independent work.
- Never perform destructive operations, deployments, or remote pushes without authorization.
- Keep documentation aligned with implemented behavior. Clearly label planned or unverified behavior.

## Change Scope and Reporting

- Respect the requested scope and avoid unrelated refactors.
- Update requirements or progress documentation when product behavior or delivery status changes.
- After completing a task, report only:
  - Implemented changes
  - Tests: PASS / FAIL / BLOCKED
  - Remaining blockers
  - Next recommended task
- Keep the response concise and do not repeat the original requirements.


