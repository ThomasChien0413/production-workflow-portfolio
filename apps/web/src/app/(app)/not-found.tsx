import Link from "next/link";
import { Card } from "@workflow/ui";

/**
 * Reached when a page calls `notFound()` — a sheet, department, template or
 * account that does not exist.
 *
 * Distinct from the error boundary on purpose: "this does not exist" and
 * "something broke" need different actions, and offering 重試 for a deleted
 * sheet would just fail again.
 */
export default function NotFound() {
  return (
    <main className="cc-page cc-stack" style={{ margin: "0 auto" }}>
      <Card>
        <div className="cc-empty">
          <p className="cc-empty__title">找不到這個項目</p>
          <p className="cc-empty__text">
            它可能已被刪除，或是連結有誤。也可能是你沒有檢視它的權限 —
            系統不會透露不屬於你的資料是否存在。
          </p>
          <Link className="cc-btn cc-btn--secondary" href="/">
            回到首頁
          </Link>
        </div>
      </Card>
    </main>
  );
}
