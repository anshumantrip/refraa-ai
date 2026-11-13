# refraaAI Phase 6 Engineering Audit

Audit date: 2026-11-13 IST. Git baseline: 2bcf7d9 with an existing dirty working tree. Changes were applied in place. No Git commit or rollback was made.

## Scope

Reviewed the frontend route and role boundaries, Express middleware, authentication and onboarding flows, MongoDB models and indexes, job criteria, private upload and parser paths, queue recovery, matching and evidence, referral decisions, notifications, analytics, and deployment configuration. Ran the repository unit and integration suites with disposable local infrastructure.

## Defect inventory

| ID | Priority | Finding and root cause | Correction |
| --- | --- | --- | --- |
| MATCH-001 | High | Matching pool included parsed resumes explicitly assigned to different jobs in the same organization. The worker query filtered only by organization. | Restrict matching to the current job and unassigned resumes. Add a compound index and a regression fixture for a different job. |
| AI-002 | High | FastAPI default request validation can echo the offending input in 422 responses. | Return a generic embedding validation message and check it through the real HTTP service. |
| NOTIFY-003 | Medium | A processing retry that ended in the same status could miss its notification because reconciliation remembered only the previous status. | Include resume generation in reconciliation and verify separate durable events for two attempts. |
| OPS-004 | Medium | API liveness returned success without a MongoDB probe. AI startup had no model readiness endpoint. | Add separate API readiness and model startup health checks and use them in the Dockerfiles. |
| TOOL-005 | Low | ESLint rejected the runner's ANSI escape regex with `no-control-regex`. | Use Node's ANSI stripping helper and rerun lint. |

## Iteration history

The source repair loop was performed in this session. The repeatable runner executes fixed checks, classifies their results, and records bounded retries and regressions. Source fixes remain reviewable changes in the repository.

| Iteration | Work and affected files | Check evidence | Checkpoint |
| --- | --- | --- | --- |
| 1 | Baseline scan. No source edits. | Dependencies present, 18 unit tests passed, production npm audit returned zero advisories, Docker unavailable. | 2bcf7d9 + existing work |
| 2 | Matching scope, AI validation, readiness, runner, environment and Docker configuration. | Initial runner recorded 11 integration passes, 18 unit passes and a build pass. The two identical lint failures were detected and stopped. Docker was blocked. | Same baseline |
| 3 | Runner lint correction, notification generation, integration assertions and docs. | Final run evidence is recorded below. | Same baseline |

## Performance evidence

The initial bounded integration pass took 79.9 seconds. Within that suite, the mixed resume test including the 1,000-file duplicate batch and recovery took 29.7 seconds. The real-service matching test including 1,000 local candidate inputs and a rerun took 5.9 seconds. These are whole fixture timings. Unique-file sustained throughput, peak memory, percentile latency and broader embedding accuracy remain unmeasured.

## Security and deployment

The suite exercises OTP hashing, expiry and replay, session revocation, CSRF and role checks, tenant-scoped reads and writes, original resume access, and independently approved referral transitions. File and text inputs were exercised with synthetic fixtures. Review target secret injection, candidate consent and retention, SMTP, bucket policy, malware scanning and the optional Atlas index before rollout. Configure MongoDB, Redis, private S3-compatible storage, the pinned embedding model, and all three workers as described in the README. No live deployment was performed.

## Unresolved

Two production sign-off records remain in [unresolved_errors](unresolved_errors). Final readiness is **PARTIALLY READY** pending target infrastructure and production workload verification.

## Final verification

Three engineering iterations, five resolved findings, and two open production sign-off records. Two bounded runner invocations recorded 15 command executions. No regression remained in the executed suite. The final pass ran on 2026-11-13 at 04:42 IST.

| Check | Outcome |
| --- | --- |
| Installed npm dependency tree, ESLint, frontend production build | PASS |
| Unit tests | PASS — 18, no failures or skips |
| Integration tests | PASS — 11, no failures or skips, 78.8 seconds |
| Production npm advisory scan | PASS — zero reported advisories |
| API and AI Docker builds | BLOCKED — Docker daemon unavailable |
| Live SMTP, target storage policy, ClamAV and optional Atlas | BLOCKED — target services or credentials unavailable |

Final integration used MongoDB, Redis/BullMQ, S3-compatible storage, Chrome and the actual FastAPI model. The resume batch case took 29.2 seconds and the matching case including rerun took 6.0 seconds. The local runner evidence is stored in `database/verification_runs/2026-11-12T23-12-40-487Z.json` (UTC filename).

This audit added no dependencies. Changed modules include the matching worker, resume model, notification worker, API and AI health handlers, Dockerfiles, verification script, integration tests, and operational documentation.
