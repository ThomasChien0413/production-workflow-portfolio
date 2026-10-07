# Portfolio setup plan

Date: 2026-10-07 (Pacific/Auckland). Repository: `production-workflow-portfolio`.

## Work ownership

| Work | Owner | Status | Scope |
| --- | --- | --- | --- |
| Independent sanitized portfolio setup | GPT | Published and verified | Public portfolio only; merged main `304e58e` passed verify, branding and containers on run `37571333913` |
| Home Screen icon regression | GPT | Merged | PR #1 passed all public CI jobs (`37569075198`) and was squash-merged as `304e58e`; main verification is running |
| Interview-ready demo walkthrough | GPT | Active | `codex/portfolio-demo-walkthrough`: optional local synthetic accounts/subpages, repeat-safe fixture tests, README badge/examples and handoff; no company data or hosting |

The user confirms permission to share code, all sheets and letterheads, while removing operational details. The original company repository, Git history, runner, server, database, DNS and credentials must remain unchanged.

## Checklist

- [x] Confirm repository name and sharing permission.
- [x] Create a separate directory and document demo constraints before implementation.
- [x] Export reviewed tracked files only, without original Git history or private operational artifacts.
- [x] Retain authorized forms/letterheads; sanitize real-record fragments and replace repeated source-example values with synthetic fixture values.
- [x] Add generic application branding, demo-only seed guard, public sample credentials and local setup documentation.
- [x] Replace company-runner CI with isolated GitHub-hosted, public-only jobs and preserve security/test gates.
- [x] Preserve third-party notices and complete initial publication-content review; manual owner review remains required.
- [x] Run local operations/unit/type/lint/build checks; record unavailable database/browser/container verification honestly.
- [x] Initialize fresh Git history and create/push a private repository for review.
- [x] Obtain explicit public-visibility approval; then verify public CI and new branding references.

## Handoff requirements

Record actual checks, remaining work and publication/audit limitations. Do not claim a full original-history secrets audit, public visibility, passing Linux visual references or a deployed demo unless actually verified. Choosing an open-source redistribution license remains the owner's decision.

## Verification — 2026-10-07

- Frozen install, TypeScript checks, lint and optimized Next.js build pass.
- Unit suite: **394 passed, 28 skipped** across 44 passing and 22 skipped files. Database-dependent tests were skipped because no isolated PostgreSQL test target is configured.
- Operations/security-policy tests: **20 passed**. Guards cover demo targets, dependency resolutions, read-only public-hosted CI and safe container cleanup.
- Windows mobile/desktop signed-out branding: **2 passed** without updating references after generating and visually inspecting the new neutral references. Includes axe checks and no-overflow assertions.
- Production dependency audit: **no known vulnerabilities found** after updating `sharp` to 0.35.5 and `@fastify/busboy` to 3.2.2. No audit exclusions or release-age exemptions added. These patches affect this portfolio only.
- Publication filename/token/resource-pattern scan passes. A separate targeted review found no retained live domain/account/host/operator contacts or copied real-order fragments in publishable text. This is a selected-pattern review, **not** a comprehensive secrets audit or a guarantee about all binary assets.
- Original source checkout remains clean; no company runtime, database, DNS, runner or cloud configuration was changed.

Not verified here: migrations against PostgreSQL, database integration tests, authenticated/full Linux E2E and all container builds. Docker/PostgreSQL command-line tools are unavailable on this machine. Public CI includes these gates, but is intentionally skipped during private review and must be checked after publication. Existing Linux blank-form references are retained, not claimed freshly verified.

## Next action

### Publication authorization — 2026-10-07

The owner explicitly approved proceeding with public visibility and full CI after the private review handoff. This authorizes publication of this independent snapshot only—not the company repository, runtime, data, credentials, runner or deployment. Verify public hosted CI before marking this work complete.

### First public run and icon correction

Repository visibility is now public. Run `37567823021` passed branding, migrations, database verification, unit/integration tests, security checks and the web build. Full browser verification had **279 passed and 1 failed**: the Home Screen manifest lacked a 512×512 icon. Container checks were dependency-skipped, not verified. The owner authorized adding the missing icon and rerunning CI. Keep the existing 512px assertion and test real PNG dimensions instead of weakening the requirement.

Local icon-fix verification: typecheck, lint, publication scan, optimized build and all 20 operations tests pass. The signed-out suite has **3 passing tests**: unchanged mobile/desktop visual references plus manifest and PNG signature/dimension checks for 192px, 512px and 180px Apple resources. The 512px route is statically generated; the generated blue-and-white icon was visually inspected. Full public CI remains pending on the fix branch; do not describe container gates or main as green yet.

Superseding result: icon PR #1 passed **verify, branding and containers** on run `37569075198`, then merged on owner authorization. Merged main also passed all three jobs on run `37571333913`. The next branch prepares optional demo fixtures and portfolio presentation; its checks must be recorded independently.

### Demo walkthrough branch handoff

- Optional demo initialization is transactional/advisory-locked and emits one synthetic-initialization audit marker. Five sample accounts, six subpages, independent identity grants and eligible template selections; no saved orders or fabricated approvals. Repetition preserves changed credentials, deactivation and permissions.
- Isolated fixture verification: **4 tests passed**, covering target/pristine-workspace guards, simultaneous calls, repeat preservation, eligible templates, audit metadata and refusal without partial writes. Existing PostgreSQL 17 binaries were found outside PATH; a new ignored, loopback-only cluster was used, never a company database.
- Typecheck, lint, publication scan and **21 operations tests** pass. A separate print-styles regression reserves one collapsed-border width inside the printable content box without changing immutable template definitions.
- Actual synthetic dashboard/subpage and blank desktop/mobile form captures are reviewed. The blank saved-sheet PDF was generated through the authenticated application endpoint, checked with Poppler (one A4 landscape page) and visually reviewed after correcting a clipped right border. Pending signature cells are blank and the state watermark remains visible. A real authorized WebSocket snapshot was required before the final capture.
- README now has a main CI badge, engineering-decision entry points, gallery, sample PDF and optional demo setup instructions. No cloud deployment, company runner or artifact-upload workaround added.
- Full new-branch public CI is pending on PR #2. Do not treat prior main CI as verification of these new changes. The owner confirmed profile pinning at action time; GitHub displayed its success message and the portfolio under Pinned. No existing pin was removed. All temporary local capture servers/proxy and the isolated PostgreSQL cluster have been stopped; generated demo data remains ignored, not published.
- Complete local suite with the dedicated optional-demo test target: **399 passed, 28 skipped** (47 passing/22 skipped files). Remaining skips are the ordinary database integration suite, which runs in public CI. Optimized web build also passes. Generated PDF preview was re-rendered and visually verified with its right border fully visible.

The independent repository was initially pushed privately for review and is now public at `https://github.com/ThomasChien0413/production-workflow-portfolio`. Its initial sanitized root commit is `0b7e432`; it does not include the original company's Git history. Initial isolation checks found **zero self-hosted runners and zero Actions secrets**. The original company repository remains private and its source checkout unchanged.

The first hosted workflow was **skipped as intended** during private review. This is not a passing full CI result; no database/E2E/container verification has been inferred from it. The standard hosted jobs run after explicit public-visibility approval.

Next action: verify the new demo-walkthrough PR independently before merging it. An open-source redistribution license remains the owner's choice. No hosted demo has been deployed.
