# Architecture and interview notes

The application is a modular monolith: one web process, one API, one worker and PostgreSQL. Shared TypeScript contracts provide runtime boundary validation; domain policies are reused by API and browser without treating hidden controls as security.

## Important decisions

| Decision | Reason / trade-off |
| --- | --- |
| Pin a sheet to an immutable template version | Publishing a new layout must not reinterpret old values or approval fingerprints. More versioning work, predictable historical documents. |
| Additive identities with explicit subpage grants | One person can cover several departments without a selected current role; template origin and workflow locks remain authoritative. Permission revocation must reauthorize reads and WebSocket rooms. |
| Transactions + mutation idempotency + audit | Workflow, history and durable jobs commit together. Replayed requests must not duplicate decisions or notifications. |
| Optimistic concurrency | Detect stale/same-field updates rather than silently overwrite another editor's work. UI must expose conflict/reconnection state. |
| Durable worker/outbox | External notification/storage failures do not lose jobs or roll back a committed sheet transition. Retry and terminal failure states are explicit. |
| Static encoded HTML for PDF | Reuse paper-layout contracts without exporting controls or unsaved browser values. Isolate pages, block external requests and bound render concurrency. |
| Separate attachment binaries and metadata | PostgreSQL holds authorization/audit metadata; private storage streams binary data. Removal denies access immediately even if physical cleanup retries. |
| Current-department/subpage history | Results obey current access, not historical creator/assignee exceptions. No search-value snippets leak confidential form contents. |

## Trace a request

Sheet mutation: validated input → session/CSRF → current database authorization → optimistic revision/idempotency check → transaction with values/state/history/audit/outbox → authorized real-time notification → UI refresh/conflict feedback.

PDF: session/current read permission → captured saved sheet and pinned definition → isolated bounded Chromium render → success-only audit → private no-store stream. Supporting attachments are not appended to the generated PDF.

## Useful code-reading entry points

- `packages/contracts/src`: validated external payloads and versioned templates.
- `packages/domain/src`: permission and workflow policies.
- `apps/api/src`: authentication, service transactions, real-time and PDF boundaries.
- `apps/worker/src`: durable delivery/cleanup workers.
- `packages/database/src`: schema, migrations, local-only bootstrap scripts.
- `packages/sheet-document/src`: shared static print renderer.
- `apps/web/src/app`: responsive account, department and sheet experiences.

## Honest limitations

This snapshot is not proof of performance under a particular company's load or a production recovery RTO. Attachment validation is basic PDF validation, not antivirus scanning. Single-host/container examples are not high availability. No drag-and-drop form builder, public registration, SSO, spreadsheet synchronization or native mobile app is included. Discuss what you personally designed, implemented and verified separately from AI-assisted or collaboratively reviewed work.
