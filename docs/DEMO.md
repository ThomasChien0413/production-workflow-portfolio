# Local interview walkthrough

Use synthetic identities and blank/demo values only. This is not an employee roster or saved production-data import.

1. Follow README local setup; log in as `admin` with `DemoOnly2026!`.
2. In account management, create an explicitly synthetic department manager. A user may have 主管 plus 員工, or identities across several departments. Use unique demo login names when display names collide.
3. Log in as that manager; open department settings and create a subpage such as `展示工作區`. Choose an eligible published template. Grant 查看、建立、修改、送審 to the appropriate department identity. New subpages intentionally start without templates/non-manager grants.
4. Open the subpage and create a sheet there. Enter only invented example values. Demonstrate saving, a stale edit/conflict in a second browser context, and the explicit workflow state.
5. For a review-required template, create synthetic 業務、協理、總經理 accounts and step through the review chain. These roles are single-active-user roles; use separate sessions. Pending signatures remain blank.
6. Demonstrate 待生產 → 生產中 → 已完成 using a synthetic user with the appropriate subpage grants and a Taipei deadline. Individual assignment was retired; identities/grants determine who may work. Final sheets appear in 完工紀錄 according to current subpage access.
7. Download the saved form PDF. Upload a harmless local test PDF as an attachment; preview/download it from an authorized account and show read-only behavior after completion.
8. Demonstrate revoked access using a synthetic staff account. Refresh/detail/PDF/attachments and real-time rooms must use the same current permission policy.

No prefilled orders or fake approval history are seeded. Blank form templates and the bootstrap admin are the initial state. Browser-push delivery is optional and needs your own newly generated demo keys; in-app notifications need no external subscription.

Before an interview, run the relevant checks and rehearse on a local disposable database. Do not show password inputs, private browser tabs or a live company environment while screen-sharing.
