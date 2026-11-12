# refraaAI

Phase 1 includes work email authentication, a company directory, verified organization membership, and dashboards for employees, recruiters, company administrators, and platform administrators.

## Local setup

1. Use Node.js 24 LTS and a MongoDB instance. Install dependencies with `npm ci`.
2. Copy `.env.example` to `.env`. Set `MONGODB_URI`, `APP_ORIGIN`, and a generated `AUTH_SECRET`. Configure an authenticated SMTP provider with `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `MAIL_FROM`. Use a sender your provider authorizes. The application reports missing credentials and rejected delivery.
3. Run `npm run seed`. This inserts 100 listings without granting access to any organization.
4. Run `npm run dev:api` and `npm run dev` in separate terminals. Open `http://localhost:5173`. The development proxy forwards same-origin API requests to port 3000.
5. Register and verify a work email. Email verification requires the registration password to prevent someone from activating an account another person registered in their name. If needed, use password recovery before verifying the address.

## Organization setup

A trusted service operator verifies the company and its email domains outside the application before activating an organization. Directory websites never count as approved email domains. First register and verify the intended administrator's account, then run:

```sh
npm run org:configure -- activate "Company name" admin@company.example company.example
npm run org:configure -- super-admin operator@company.example
```

The activation command replaces the organization's approved domain list with the domains supplied. Omitting domains leaves verification available by email invitation or administrator review. Only a trusted operator with database credentials can grant Company Admin or Super Admin. Company administrators can approve a member as an employee or recruiter, decline a request, or send an invitation to a specific work email. A verified domain grants employee access. Recruiter access requires an explicit grant, and a recruiter may also choose the employee role. A platform administrator needs separate verified membership to access a tenant dashboard.

Seed entries use company names, industries, and official site references. Profiles show headquarters, descriptions, logo images, and careers links when those details are available in the seed. The directory uses initials when a logo is unavailable.

## Production build

Run `npm run build` and `npm start` from the project root, or build the supplied Dockerfile. Express serves the frontend and API from one origin. In production use the public HTTPS origin for `APP_ORIGIN`. Set `TRUST_PROXY_HOPS` only for a known proxy topology with sanitized forwarding headers. Supply secrets through the runtime environment and use an authenticated MongoDB deployment. Run the seed and operator commands with credentials authorized for those tasks.

## Verification

Run `npm run lint`, `npm run build`, and `npm test`. For database tests, set `TEST_MONGODB_URI` to a dedicated test MongoDB instance and run `npm run test:integration`. Each invocation creates a uniquely named test database and retains it for inspection. To include the browser workflow, set `BROWSER_CHANNEL=chrome` or `BROWSER_EXECUTABLE` to an installed Chromium browser. The automated tests capture email content in memory and check missing SMTP configuration independently. A live provider test requires valid SMTP credentials and a deliverable mailbox.
