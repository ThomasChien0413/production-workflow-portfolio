"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Card } from "@workflow/ui";
import { csrfHeaders } from "@/lib/csrf";
import { useInteractive } from "@/lib/use-interactive";
import type { AvailableTemplate } from "@/lib/sheet-model";
import { SheetDocument } from "@/app/(app)/sheets/[sheetId]/sheet-form";
import { newMutationId } from "@/lib/mutation-id";

/** A subpage the user may create in, with the forms ticked for it. */
export type CreatableSubpage = { id: string; name: string; templates: AvailableTemplate[] };

// A preview has nothing written and nothing to write.
const noValues = new Map<string, string>();
const notEditable = () => false;
const noEdit = () => undefined;

/**
 * The create page (the user, 2026-09-30): pick the form, see it blank right
 * below exactly as it will print, then create it. Nothing exists until
 * 建立生產單 is pressed; the new sheet then opens for filling in.
 *
 * Opened from a subpage, that subpage is implied. Opened from the department
 * page, the user picks the subpage first, and it offers only the forms that
 * subpage ticks. Every subpage the user may create in is listed, a subpage
 * that ticks no form included: hiding it left people looking for a subpage
 * that was there (the user, 2026-10-01). Choosing one says why nothing can be
 * created in it yet. The selection is kept in the URL, so a reload keeps it.
 */
export function NewSheet({
  departmentId,
  subpages,
  initialSubpageId,
  initialTemplateId,
  chooseSubpage,
}: {
  departmentId: string;
  subpages: CreatableSubpage[];
  initialSubpageId?: string | undefined;
  initialTemplateId?: string | undefined;
  chooseSubpage: boolean;
}) {
  const router = useRouter();
  const interactive = useInteractive();
  const usable = subpages.filter((subpage) => subpage.templates.length > 0);
  const [subpageId, setSubpageId] = useState(
    () =>
      subpages.find((subpage) => subpage.id === initialSubpageId)?.id ??
      usable[0]?.id ??
      subpages[0]?.id ??
      "",
  );
  const subpage = subpages.find((candidate) => candidate.id === subpageId);
  const templates = subpage?.templates ?? [];
  const [templateId, setTemplateId] = useState(
    () => templates.find((template) => template.id === initialTemplateId)?.id ?? templates[0]?.id ?? "",
  );
  const template = templates.find((candidate) => candidate.id === templateId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Preserve the same key across retries of one intent so a lost response
  // cannot create a duplicate sheet.
  const [mutationId, setMutationId] = useState<string | null>(null);

  function choose(nextSubpageId: string, nextTemplateId: string) {
    setSubpageId(nextSubpageId);
    setTemplateId(nextTemplateId);
    setMutationId(null);
    setError(null);
    const url = new URL(window.location.href);
    url.searchParams.set("subpage", nextSubpageId);
    url.searchParams.set("form", nextTemplateId);
    window.history.replaceState(null, "", url);
  }

  async function create() {
    const attempt = mutationId ?? newMutationId();
    setMutationId(attempt);
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/sheets", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ clientMutationId: attempt, templateId, originDepartmentId: departmentId, subpageId }),
      });
      const body = await response.json().catch(() => null) as { sheet?: { id: string }; message?: string } | null;
      if (!response.ok || !body?.sheet) {
        setError(body?.message ?? "無法建立生產單，請稍後再試。");
        return;
      }
      router.push(`/sheets/${body.sheet.id}`);
    } catch { setError("無法連線到伺服器，請檢查網路後再試一次。"); }
    finally { setPending(false); }
  }

  if (usable.length === 0) return <Alert tone="info" title="目前沒有可建立的表單">請由部門主管在表單權限設定中選擇此子分頁可建立的表單。</Alert>;

  return <>
    <Card header={<h2 className="cc-h3">選擇表單</h2>}>
      <div className="cc-stack">
        {error ? <Alert tone="danger" title="無法建立" assertive>{error}</Alert> : null}
        <div className="cc-form-grid">
          {chooseSubpage ? (
            <div className="cc-field"><label className="cc-label" htmlFor="create-subpage">工作子分頁</label><select className="cc-select" id="create-subpage" value={subpageId} disabled={pending || !interactive} onChange={(event) => { const next = subpages.find((candidate) => candidate.id === event.target.value); choose(event.target.value, next?.templates[0]?.id ?? ""); }}>{subpages.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.templates.length > 0 ? candidate.name : `${candidate.name}（尚未開放表單）`}</option>)}</select></div>
          ) : null}
          <div className="cc-field"><label className="cc-label" htmlFor="create-template">表單範本</label><select className="cc-select" id="create-template" value={templateId} disabled={pending || !interactive || templates.length === 0} onChange={(event) => choose(subpageId, event.target.value)}>{templates.length === 0 ? <option value="">此子分頁尚未開放表單</option> : templates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.displayName}</option>)}</select></div>
        </div>
        {subpage && templates.length === 0 ? (
          <Alert tone="info" title={`「${subpage.name}」尚未開放可建立的表單`}>
            部門主管可在表單權限設定中，為這個子分頁勾選可建立的表單。也可以改選其他子分頁。
          </Alert>
        ) : null}
      </div>
    </Card>

    {template ? (
      <section className="cc-stack" aria-labelledby="create-preview-title">
        <div>
          <h2 className="cc-h2" id="create-preview-title">表單預覽・{template.displayName}</h2>
          <p className="cc-body-sm cc-muted">這是空白表單的樣式，建立後才能填寫與儲存。</p>
        </div>
        {/* Keyed by form, so switching forms starts from a fresh layout. */}
        <SheetDocument key={template.id} definition={template.definition} values={noValues} editable={notEditable} onEdit={noEdit} />
      </section>
    ) : null}

    <div className="cc-action-bar">
      <p className="cc-body-sm cc-action-bar__status">
        {template && subpage ? <>將在「{subpage.name}」建立「{template.displayName}」</> : "請選擇表單"}
      </p>
      <Button variant="primary" size="lg" disabled={!interactive || pending || !templateId || !subpageId} loading={pending} loadingLabel="建立中…" onClick={() => void create()}>建立生產單</Button>
    </div>
  </>;
}
