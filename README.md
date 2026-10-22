# StellarAid — student donation app (Paiflow + Stellar)

A Next.js web app for collecting **testnet XLM donations** that support students in need of financial assistance. Donors connect Freighter, choose a student to champion, enter a donation amount, and sign the payment in their wallet. Every donation is split automatically: **90% goes to the student** and **10% goes to the student organization**.

The split is enforced by a **Paiflow deployment**, not by app code. The app drives one explicitly configured deployment through `@paiflow/sdk`; the browser never receives the Paiflow credential.

## How the 90/10 split works

Payment logic lives in the flow you deploy in the Paiflow console. StellarAid expects an **On Receive (native XLM, testnet) → Split** flow:

1. Recipient 1 — the student's Stellar address at **9000 bps (90%)**
2. Recipient 2 — the student organization's Stellar address at **1000 bps (10%)**, placed last so the rounding remainder lands with the org

Percentage shares must each be greater than zero and sum to exactly 10,000 bps. The app cannot create or deploy flows, and per-payment recipient selection is not available during the hackathon — the deployed flow's recipients are authoritative for every donation. Choosing a student in the UI records the donor's intent app-side (for attribution and the thank-you screen); on-chain routing always follows the deployed split. Real per-student payouts would require one deployment per student.

## Features

- **Student directory** — a curated list of students in need, each with a name, story, and funding goal
- **Donor-entered amounts** — donations in XLM, converted to stroops with bigint arithmetic (never floating point), validated server-side with a minimum (0.1 XLM, so the 10% leg is not dust) and a sanity maximum
- **Transparent split preview** — a live 90/10 breakdown of the entered amount before the donor commits
- **Sign-in gate** — a demo username/password (server-checked, never in the browser bundle) remembered in a signed HttpOnly cookie; the payment API refuses unsigned requests
- **Admin panel** — a separate admin role that curates the student directory: post each student's name and story and set the funding goal (in XLM); donors see the updated directory immediately
- **Fund transparency dashboard** — totals from confirmed donations recorded server-side (idempotent by transaction hash, re-verified with the platform before writing), expected 90/10 split, per-student progress bars against goals, and per-recipient payout evidence pulled from the deployment's event feed
- **Non-custodial payments** — Freighter signs in the browser using the server-prepared testnet passphrase; the app never handles private keys
- **Exact-envelope submission** — the signed transaction body and hash are compared against the original preparation; altered operations and fee-bump envelopes are rejected
- **Bounded confirmation and recovery** — interrupted donations resume by re-checking the original transaction hash only; the exact signed envelope is the only thing ever retried

## Choose your starting point

Use the SDK in your own app when you already have an application. Use this example when you want a runnable reference for the prepare → sign → submit → verify → recover lifecycle with a real split-payout deployment behind it. [Campus Snacks](https://github.com/artisam-paiflow/paiflow-campus-snacks) is a separate application sample for a campus ordering use case.

For the flow-building walkthrough, use the [Paiflow Guide](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/hackathon/paiflow-guide.md). For detailed integration reference, use the [SDK README](https://github.com/artisam-paiflow/paiflow/blob/develop/packages/sdk/README.md) and [API README](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/README.md).

## Run locally

Requires **Node `>=22.22.2 <23`** and **pnpm `10.4.1`**.

```sh
git clone https://github.com/artisam-paiflow/paiflow-hackathon-starter.git
cd paiflow-hackathon-starter
npm install --global pnpm@10.4.1
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

Open http://localhost:3000. Without complete server configuration, donation actions remain disabled.

The dependency is pinned to **`@paiflow/sdk@0.2.0`**, published under npm's `beta` tag. Developer tokens require a backend implementing OpenAPI `1.1.0`, including the staging environment checked on October 17, 2026.

## Configure your deployment

1. In Paiflow, build and deploy an **On Receive (native XLM) → Split** flow: the student's address at 9000 bps first, the student organization's address at 1000 bps second. Wait for confirmation and review those recipients — they are authoritative for every donation. This app does not create or deploy flows.
2. In **Account → Developer**, create a **Read and operate** token and explicitly grant it access to that deployment. Copy its one-time `pfd_` secret. An existing deployment-bound `pfk_` token from **API access** also works.
3. Set these server-only values in `.env.local`, then restart:

```dotenv
PAIFLOW_BASE_URL=https://beta.app.paiflow.xyz
PAIFLOW_DEPLOYMENT_ID=<your confirmed deployment UUID>
PAIFLOW_API_TOKEN=<your pfd_ or pfk_ token>
DEMO_USERNAME=<your chosen demo username>
DEMO_PASSWORD=<your chosen demo password>
ADMIN_USERNAME=<your chosen admin username>
ADMIN_PASSWORD=<your chosen admin password>
# Optional: APP_SESSION_SECRET=<random 32+ characters>; falls back to PAIFLOW_API_TOKEN
```

There are two demo roles. The **donor** role (`DEMO_*`) signs in to the donation app. The **admin** role (`ADMIN_*`) signs in to the admin panel, where they edit the student directory — names, stories, and XLM funding goals — stored server-side in `data/students.json` and validated before every save. Donor sessions cannot touch the directory API.

The sign-in gate is demo-grade: shared usernames and passwords per role, verified on the server with constant-time comparison and remembered for 12 hours in an HMAC-signed `HttpOnly` cookie. It keeps casual visitors out of the payment flow, but it is not a real account system — there are no per-user identities, roles, lockouts, or reset flows. Never reuse a password you care about.

Never use `NEXT_PUBLIC_` for these settings, commit `.env.local`, or put wallet secret keys into the app. The app uses the configured deployment, never the first discovery result. A developer token must explicitly include that deployment.

Complete credentials enable the app. Removing them disables new API actions but does not cancel an existing transaction. Retain recovery evidence when changing configuration.

## Make a donation

1. Install Freighter. Fund a dedicated testnet donor wallet with enough XLM for the donation and transaction fees. Use testnet recipients; mainnet and non-native-XLM deployments are refused.
2. Pick a student from the directory and enter an amount within the advertised limits. The app shows the 90/10 split of your amount.
3. Connect the wallet and prepare the donation. Review your deployment and its recipients in Paiflow, then sign in Freighter. The app uses the server-prepared network passphrase, checks the wallet's network, and verifies the signed transaction body against the original preparation.
4. Check the original transaction's status. `SUCCESS` confirms that transaction. `PENDING`, `UNKNOWN`, missing history and transport errors remain unresolved.
5. Inspect the actual recipient payouts in Paiflow or a testnet explorer. A transaction confirmation is not an application receipt, and the deployed Split — not this app — decides the final payout amounts.

This is a donation demonstration, not a production fundraising platform. It has no donor authentication, persistent donation database, student identity verification, or fulfilment system, and it does not independently verify the deployed recipients or split. Real applications need session/ownership checks, rate limits, durable donation-to-transaction binding, and exact receipt verification.

## Recover an interrupted donation

The app saves the original preparation before signing and the exact signed envelope before submission. Recovery is scoped to the configured platform and deployment. Browser storage and Web Locks are required; a storage failure blocks the next financial step.

Preparation, submission and manual status requests each have a 30-second browser response deadline. A submission timeout does not cancel or reject the transaction.

After submission, a pending response, RPC error or lost response starts **Confirmation pending—checking the original transaction**. The app makes only status lookups: at most six attempts over one 30-second confirmation window, with backoff and `Retry-After` respected. Each lookup uses only the time remaining in that window; it never starts a fresh 30-second window. Reloading an attempted unresolved signed donation resumes one bounded check of its original hash. No automatic check prepares, signs or submits another transaction.

Use **Stop checking** to stop the read-only checks, or **Check original transaction** to check again after the bounded check finishes. Both preserve the original evidence. Manual retry sends only the **same signed envelope**; it is never automatic. Keep original evidence after a timeout, rejected response, `UNKNOWN`, `NOT_FOUND` or expired preparation. None proves that a replacement is safe. Do not clear browser data to start over while an operation is unresolved. If no signature is available after expiry, ask the platform operator to establish the outcome.

Recovery is local to this browser and origin. Lost storage, a different machine or a lost preparation response may require operator assistance. Browser storage is teaching code, not durable cross-device payment storage. Never log or share signed envelopes or full recovery records.

An unresolved donation record for another platform or deployment blocks a new donation; restore its original server configuration to reconcile it. Recovery checks retain existing evidence rather than silently deleting or converting it.

## Code map

| File                           | Responsibility                                                  |
| ------------------------------ | --------------------------------------------------------------- |
| `lib/paiflow.ts`               | Server-only configuration and typed SDK payment calls           |
| `app/api/pay/route.ts`         | Allowlisted prepare (with amount), submit and status actions    |
| `app/api/integration/route.ts` | Non-secret configuration state                                  |
| `lib/amount.ts`                | Decimal-XLM ↔ stroops conversion (bigint, no floats)            |
| `lib/students.ts`              | Student directory and organization info (pure data, no secrets) |
| `lib/wallet.ts`                | Freighter connection and signing                                |
| `lib/recovery.ts`              | Original transaction evidence and validation                    |
| `lib/session.ts`               | Signed HttpOnly session cookies, roles, constant-time compares  |
| `app/api/session/route.ts`     | Demo login/logout with server-checked credentials               |
| `components/login-gate.tsx`    | Sign-in screen shown before the donation app                    |
| `lib/student-store.ts`         | Validated, atomic read/write of `data/students.json`            |
| `app/api/students/route.ts`    | Admin-only directory replacement                                |
| `components/admin-app.tsx`     | Admin panel for student stories and goals                       |
| `lib/donation-store.ts`        | Validated donation ledger and transparency aggregation          |
| `app/api/donations/route.ts`   | Dashboard reads; confirmed-donation recording (idempotent)      |
| `lib/transaction.ts`           | Transaction hashing and unchanged-envelope checks               |
| `components/starter-app.tsx`   | Donation walkthrough: transparency matrix, directory, amount, recovery |
| `components/signed-in-app.tsx` | Signed-in shell that switches donor/admin views                  |
| `components/user-menu.tsx`     | Header user menu: identity, role, view switch, logout            |

The SDK supplies transport, typed responses and API metadata. Your app supplies wallet consent, storage, authorization, reconciliation decisions and business rules.

## Checks and evidence

```sh
pnpm typecheck
pnpm test
pnpm build
node scripts/check-browser-bundle.mjs
```

Tests use fixtures and mocked upstream responses. They do not establish live wallet consent or payout readiness. Complete a small authorized testnet rehearsal against your deployment before demonstrating it. No fresh signed payment was made for this migration.

Follow your event's primer for permissions, deadlines and submissions. See [`llms.md`](llms.md) for shared Paiflow SDK integration context; use this README and current source for this runnable example.
