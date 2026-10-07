"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@workflow/ui";

export function UserFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const active = params.get("active");

  function apply(next: { q?: string; active?: string | null }) {
    const search = new URLSearchParams(params.toString());
    const q = next.q ?? query;
    if (q.trim() === "") search.delete("q");
    else search.set("q", q.trim());

    if (next.active === null) search.delete("active");
    else if (next.active !== undefined) search.set("active", next.active);

    router.push(search.size > 0 ? `/admin/users?${search}` : "/admin/users");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    apply({});
  }

  return (
    <form className="cc-row" onSubmit={handleSubmit} role="search">
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <label className="cc-sr-only" htmlFor="user-search">
          搜尋姓名或登入名稱
        </label>
        <input
          className="cc-input"
          id="user-search"
          type="search"
          placeholder="搜尋姓名或登入名稱"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <Button type="submit" variant="secondary">
        搜尋
      </Button>
      <div className="cc-row" style={{ gap: "var(--cc-space-2)" }}>
        <Button
          type="button"
          variant={active === null ? "primary" : "secondary"}
          aria-pressed={active === null}
          onClick={() => apply({ active: null })}
        >
          全部
        </Button>
        <Button
          type="button"
          variant={active === "true" ? "primary" : "secondary"}
          aria-pressed={active === "true"}
          onClick={() => apply({ active: "true" })}
        >
          啟用中
        </Button>
        <Button
          type="button"
          variant={active === "false" ? "primary" : "secondary"}
          aria-pressed={active === "false"}
          onClick={() => apply({ active: "false" })}
        >
          已停用
        </Button>
      </div>
    </form>
  );
}
