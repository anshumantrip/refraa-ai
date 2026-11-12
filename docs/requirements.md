# refraaAI Product Requirements

## 1. Product Overview

refraaAI is a production-ready, AI-powered employee referral and resume intelligence SaaS platform. It helps organizations process candidate resumes, assess candidates against role requirements, and support employee referrals while keeping people in control of referral decisions.

This document records the complete requirements supplied in the project specification available at project setup. The project directory contained no earlier specification or implementation files. Detailed screens, workflows, policy rules, and integrations not specified here must be confirmed or added as requirements before implementation; they must not be invented as product facts.

## 2. Technology Requirements

- Frontend: React with Tailwind CSS.
- Application backend: Node.js with Express.
- Primary database: MongoDB.
- AI service: Python with FastAPI and Sentence Transformers.
- Background job processing: Redis with BullMQ.
- Resume and file storage: S3-compatible object storage.
- Deployment packaging: Docker.

The implementation should use these technologies consistently, while respecting any established repository architecture and conventions.

## 3. User and Organization Access

### 3.1 Authentication

- Provide secure authentication.
- Support email one-time passcode (OTP) verification.
- Protect account and session flows against unauthorized access.

### 3.2 Organizations, Membership, and Roles

- Organization membership must be verified before a user receives organization access.
- Access must be role-based.
- Authorization must be enforced by backend services for each protected operation.

### 3.3 Tenant Isolation

- Organization data must be isolated at the tenant level.
- Tenant isolation applies across application APIs, database access, file storage, background processing, and AI processing.
- A user from one tenant must not be able to read, change, or infer another tenant’s data through direct requests, search, jobs, or generated results.

## 4. Resume Intake and Processing

- The platform must accept resumes as inputs to resume intelligence workflows.
- Bulk resume processing must be asynchronous and use background jobs rather than block a user-facing request until the whole batch is processed.
- The technology stack for background processing is Redis and BullMQ.
- Resume files must use S3-compatible object storage.
- Processing status and failures should be represented so users and operators can distinguish pending, completed, and failed work.
- Resume content is untrusted input and must be handled safely.

The source specification does not define accepted formats, size limits, extraction fields, retention periods, or retry policy. These are open product and operational decisions.

## 5. Candidate and Role Matching

- The platform must provide AI-powered resume intelligence and candidate matching against role requirements.
- The AI service uses Python, FastAPI, and Sentence Transformers.
- Candidate assessments must be evidence-based. Each material match or gap should be grounded in available resume or role evidence.
- The system must not fabricate candidate qualifications, employment history, education, experience, or other personal information.
- Missing or uncertain information must not be presented as established fact.
- Scoring configuration must support Experience and CGPA as independently switchable ON/OFF criteria.
- Turning either criterion ON or OFF must change the actual scoring computation; the setting cannot be cosmetic or limited to display.
- Active scoring weights must total exactly 100% before scoring can use that configuration.
- “Top N” candidate results must contain only candidates that meet the system’s suitability criteria. If fewer than N candidates are suitable, return fewer than N rather than padding the result with unsuitable candidates.

The source specification does not define the scoring formula, evidence schema, suitability thresholds, tie-breaking, or how Experience and CGPA interact with configurable weights. Those details must be specified before they are relied on for production decisions.

## 6. Referrals and Human Oversight

- The platform must support employee referrals.
- A human must approve each referral before it is submitted or finalized.
- AI matching or ranking must not itself approve or submit a referral.
- The approval state and the human decision should be represented by the application workflow.

The source specification does not define the referral lifecycle, approver roles, notifications, or audit requirements; add these details when confirmed.

## 7. Privacy, Security, and Integrity

- Never hardcode secrets or credentials.
- Preserve tenant boundaries for candidate personal information and resume files.
- Do not fabricate candidate data or imply unsupported certainty.
- Follow secure authentication and authorization practices.
- Keep the system production-ready, including safe handling of uploaded documents and background work.

Retention, consent, deletion, encryption, data residency, and compliance requirements are not defined in the available project specification and require product decisions.

## 8. Deployment

- Package/deploy services using Docker.
- The architecture includes the React/Tailwind frontend, Express backend, MongoDB, FastAPI AI service, Redis/BullMQ worker processing, and S3-compatible object storage.
- Secrets and environment-specific configuration must be provided outside source code.

The source specification does not define a cloud provider, production topology, availability targets, backup policy, or observability stack.

## 9. Acceptance Criteria

A release satisfies the explicit requirements when:

1. Users authenticate securely and complete email OTP verification.
2. Organization membership is verified and permissions are enforced by role.
3. Requests and asynchronous processing cannot cross tenant boundaries.
4. Bulk resume work is queued and processed asynchronously, with outcomes observable to the application.
5. AI match explanations are grounded in candidate and role evidence and do not invent facts.
6. Experience and CGPA switches change the underlying scoring behavior.
7. A scoring configuration with active weights not totaling 100% cannot be used as valid scoring configuration.
8. Top N output includes only suitable candidates and may contain fewer than N results.
9. Referral submission/finalization requires an explicit human approval.
10. The defined service stack can be packaged with Docker without embedding secrets in source code.

## 10. Source and Open Requirements

The project brief and engineering instructions supplied the initial requirements. The Phase 1 specification below resolves access and onboarding decisions. Before implementing other unspecified product behavior, extend this document with confirmed decisions for:

- Resume formats, file limits, extraction fields, and lifecycle/retention.
- Matching and scoring formula, weight categories, evidence representation, and suitability threshold.
- Top N configuration and filtering rules beyond the explicit suitability constraint.
- Referral states, approval authority, audit trail, and notifications.
- Privacy, consent, deletion, encryption, compliance, and data residency.
- Service-level, scale, monitoring, backup, and disaster-recovery targets.

## 11. Phase 1 Authentication and Company Onboarding

- Registration collects a full name, work email, password, and confirmation. Use bcrypt hashing, input validation, rate limits, secure HTTP-only production cookies, CSRF protection, persistent sessions, and sign-out. Unverified accounts cannot sign in or access protected features.
- Send six-digit email codes through an environment-configured SMTP provider. Store a keyed hash, expire the code after ten minutes, enforce five failed attempts and a 45-second resend cooldown, and consume the code atomically. The six input fields support auto-focus, paste, and backspace navigation.
- Password reset uses a single-use email link that expires after 30 minutes. A successful reset invalidates existing sessions. Missing email credentials and delivery failures produce explicit errors.
- Seed 100 company listings in technology, finance, consulting, and e-commerce. Support search, industry filters, profile views, and submissions. Deduplicate by normalized company name and website host. Submissions stay pending until verified. Store optional profile information where verified.
- Selecting a company starts a pending request. Verify membership through an operator-approved email domain, an invitation tied to the verified email and organization, or company administrator approval.
- Enforce Super Admin, Company Admin, Recruiter, and Employee / Referrer permissions on the backend. Company domains grant employee access. Recruiter access requires an invitation or administrator approval. Only a trusted operator grants administrator roles.
- Deliver responsive React and Tailwind screens for sign-in, registration, verification, password recovery, company directory and profiles, company submission, membership verification, account type, onboarding completion, and each role's dashboard.
- Verify the full path from registration and email OTP through sign-in, company selection, membership verification, authorized role selection, and the dashboard.
