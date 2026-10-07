# Production Workflow Portfolio — design

## Scope and presentation

An independent, runnable demonstration adapted with the owner's permission from an internal manufacturing workflow application. Retain all 27 authorized form templates and their letterheads, source-backed fields, immutable versions and print-faithful rendering. No real saved orders, users or production values are copied.

Retain the existing Traditional Chinese, blue-and-white responsive component system. Rebrand only application identity/metadata/icons with a neutral `Workflow Portfolio` mark at the existing dimensions; do not rearrange form layouts or alter business rules. Company artwork inside explicitly authorized letterheads remains form content, not application branding.

Home Screen resources use the same centered white `WF` on medium-blue square artwork: 192×192 PNG at `/icon`, 512×512 PNG at `/icons/icon-512`, and 180×180 Apple PNG at `/apple-icon`. The manifest advertises both 192 and 512 sizes with purpose `any`; no maskable claim is made. Generate the missing 512 resource statically using the existing neutral icon proportions. Anonymous resource tests validate MIME, PNG signature and actual dimensions; no login or database is required.

## Engineering

- TypeScript/pnpm monorepo: Next.js web, Fastify REST/WebSocket API, durable background worker, PostgreSQL, shared runtime validation and domain policies.
- Multiple department identities and subpage grants; API-enforced access; ordered review of 分條申請單; atomic transitions, immutable history, explicit saving and optimistic concurrency.
- Authenticated saved-sheet PDF generation and private PDF attachments remain separate features. Demo attachment storage uses a local ignored directory/volume; no company bucket or credentials.
- Phone/browser push is optional and requires newly generated demo keys. No live key pair, subscription or notification recipients are copied. In-app notification history is usable without push keys.
- Standard GitHub-hosted Ubuntu CI for application/forms and Windows for login-branding references, read-only repository token, no privileged PR trigger, self-hosted runner, production connection or deployment job. Hosted jobs must skip while the new repository is private to avoid consuming private Actions quota. CI artifact uploads/caches are omitted initially.
- Preserve dependency audit and existing regression assertions. New application branding receives separate Windows login visual references at 390×844 and 1366×900, including axe accessibility and overflow checks, rather than overwriting unrelated Linux form baselines. No API or database is needed for the signed-out suite. Do not suppress browser failures or rely on retry success.
- Demo bootstrap credentials are clearly public, for loopback/local development only, and differ from the company's original bootstrap value. Add an explicit remote/production seed guard.

## Publication boundary

Exclude private operational documents, machine-management scripts, AWS identifiers/endpoints, alert contacts, browser states and original Git history. Preserve authorized form assets and third-party notices. Perform a file/content audit and local verification before pushing the fresh snapshot privately. Public visibility is a later explicit review/approval step; publication does not deploy the company system.

No production readiness, real company load, private recovery or individual coding-authorship claim is implied by demo verification.
