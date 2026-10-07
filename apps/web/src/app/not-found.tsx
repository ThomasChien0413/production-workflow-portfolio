import Link from "next/link";

/**
 * A URL that matches no route at all — outside the signed-in shell, so this
 * one cannot assume there is a session to navigate with.
 */
export default function NotFound() {
  return (
    <main className="cc-page cc-stack" style={{ margin: "0 auto", maxWidth: "640px" }}>
      <h1 className="cc-h1">找不到這個頁面</h1>
      <p className="cc-body cc-secondary">
        這個網址不存在，可能是連結有誤或頁面已移除。
      </p>
      <div className="cc-row">
        <Link className="cc-btn cc-btn--primary" href="/">
          回到首頁
        </Link>
      </div>
    </main>
  );
}
