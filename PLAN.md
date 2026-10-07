# Portfolio setup plan

Date: 2026-10-07 (Pacific/Auckland). Repository: `production-workflow-portfolio`.

## Work ownership

| Work | Owner | Status | Scope |
| --- | --- | --- | --- |
| Independent sanitized portfolio setup | GPT | Public CI verification active | User authorized public visibility on 2026-10-07; publish only this repository, inspect full hosted CI and record actual results |

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
- [ ] Obtain explicit public-visibility approval; then verify public CI and new branding references.

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

The independent repository is created and pushed privately at `https://github.com/ThomasChien0413/production-workflow-portfolio`. Its initial sanitized root commit is `0b7e432`; it does not include the original company's Git history. Repository visibility is verified private, with **zero self-hosted runners and zero Actions secrets**. The original company repository remains private and its source checkout unchanged.

The first hosted workflow was **skipped as intended** during private review. This is not a passing full CI result; no database/E2E/container verification has been inferred from it. The standard hosted jobs run after explicit public-visibility approval.

Owner next action: review the included form assets and README/provenance, choose whether to grant an open-source license, then explicitly authorize public visibility. After publication, inspect the hosted CI results and resolve any platform/database/container failures before advertising verification as complete. No hosted demo has been deployed.
