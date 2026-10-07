# Local interview walkthrough

Use synthetic identities and blank/demo values only. This is not an employee roster or saved production-data import.

1. Follow README local setup; log in as `admin` with `DemoOnly2026!`.
2. Optionally run `pnpm db:demo` immediately after the base seed on an untouched local database. Log in as `demo.manager` to manage all six departments or `demo.staff` to demonstrate the union of 員工 and 訂單人員 grants. All sample accounts use `DemoOnly2026!`; reviewers are `demo.sales`, `demo.associate` and `demo.gm`. No real people are represented.
3. The optional seed creates `展示工作區（範例）` in each department, enables eligible active published templates, and grants both demo identities 查看、建立、修改、送審. To demonstrate setup yourself, skip this optional seed and create synthetic users/subpages through account/department settings. Ordinary new subpages still start without templates/non-manager grants.
4. Open the subpage and create a sheet there. Enter only invented example values. Demonstrate saving, a stale edit/conflict in a second browser context, and the explicit workflow state.
5. For 分條申請單, use the synthetic 業務、協理、總經理 accounts to step through the review chain. These roles are single-active-user roles; use separate sessions. Pending signatures remain blank.
6. Demonstrate 待生產 → 生產中 → 已完成 using a synthetic user with the appropriate subpage grants and a Taipei deadline. Individual assignment was retired; identities/grants determine who may work. Final sheets appear in 完工紀錄 according to current subpage access.
7. Download the saved form PDF. Upload a harmless local test PDF as an attachment; preview/download it from an authorized account and show read-only behavior after completion.
8. Demonstrate revoked access using a synthetic staff account. Refresh/detail/PDF/attachments and real-time rooms must use the same current permission policy.

No prefilled orders or fake approval history are seeded. Base initialization contains blank templates and bootstrap admin; the optional initializer adds only synthetic accounts/subpages/settings. Repetition is a no-op even after you change passwords or grants. An existing manually configured workspace is refused on first initialization. Browser-push delivery is optional and needs your own newly generated demo keys; in-app notifications need no external subscription.

Before an interview, run the relevant checks and rehearse on a local disposable database. Do not show password inputs, private browser tabs or a live company environment while screen-sharing.

## Reproduce the README captures

This is optional developer tooling, not hosting. Use a newly migrated/seeded local database named **workflow_demo_showcase**, run `db:demo`, and keep its contents synthetic. The capture refuses unrelated databases/accounts, multiple sheets or any entered text/numeric values. It can re-render only its single unchanged blank sheet.

Run the API on loopback port 3331 with APP_ORIGIN `http://localhost:3330`; run the web on loopback port 3340 with API_ORIGIN `http://127.0.0.1:3331`. Start `node scripts/demo/preview-proxy.mjs` to provide the local same-origin HTTP/WebSocket endpoint on port 3330. The proxy has fixed loopback targets and streams responses; it is not a public reverse-proxy configuration.

With DATABASE_URL pointing to that dedicated showcase and after `pnpm build`, run `pnpm demo:capture`. The owned test browser logs in through the normal authentication endpoint, verifies an authorized sheet snapshot arrives, creates a blank sheet through the UI only if none exists, and exports the saved PDF. It writes no browser storage-state file. Output goes to `docs/images` and `docs/examples`; inspect all files before committing. Render the PDF with Poppler to update `docs/images/pdf-preview.png` and verify the border, labels, empty signatures and watermark. Sticky action controls are excluded from form-only images using the established visual-test convention; workflow errors are not concealed.

Stop these local processes afterward. Never substitute a company instance, real credentials or a database containing useful work.
