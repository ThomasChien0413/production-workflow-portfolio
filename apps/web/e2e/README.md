# Browser verification

`pnpm test:e2e` starts local API/web servers and uses a disposable migrated/seeded PostgreSQL database selected by DATABASE_URL. Fixtures create synthetic accounts and sheets. Never use a database containing important data.

Linux Chromium compares the retained blank-paper references for all 27 authorized templates at mobile/desktop sizes. `VISUAL_LOCAL=1` can generate uncommitted platform-specific form references for development; those are not CI approvals. Regenerate Linux references only after reviewing an intentional layout change.

`pnpm test:branding` is a separate Windows Chromium suite for the neutral signed-out login at 390×844 and 1366×900. It needs no API or database, waits for local fonts, checks WCAG AA semantics/overflow and compares committed Windows references. Generate an intentional branding change on Windows with `pnpm test:branding --update-snapshots`, inspect both PNGs, then rerun without updates. CI runs this suite on a standard Windows GitHub-hosted runner.

Snapshots are platform-specific because font rasterization differs. Do not replace Linux paper references with Windows output or copy authentication screenshots from a company environment. A retry that passes remains a failing flaky-test gate in CI. Traces/reports are ignored and not automatically uploaded by the public workflow.
