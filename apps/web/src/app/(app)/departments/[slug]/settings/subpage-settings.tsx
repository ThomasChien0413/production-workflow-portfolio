"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { membershipKindLabels } from "@workflow/contracts";
import { Alert, Badge, Button, Card, ScrollRegion } from "@workflow/ui";
import { csrfHeaders } from "@/lib/csrf";
import { useInteractive } from "@/lib/use-interactive";
import type { DepartmentSubpagePage, DepartmentSubpageView, SubpageIdentityPermission } from "@/lib/subpages";
import { newMutationId } from "@/lib/mutation-id";

type IdentityKind = "ORDER_TAKER" | "STAFF";
type PermissionKey = "canView" | "canCreate" | "canEdit" | "canSubmit";
const identityKinds: IdentityKind[] = ["ORDER_TAKER", "STAFF"];
const permissionKeys: PermissionKey[] = ["canView", "canCreate", "canEdit", "canSubmit"];
const labels: Record<PermissionKey, string> = { canView: "查看", canCreate: "建立", canEdit: "修改", canSubmit: "送審" };
const emptyPermission = (kind: IdentityKind): SubpageIdentityPermission => ({ kind, canView: false, canCreate: false, canEdit: false, canSubmit: false });

export function SubpageSettings({ departmentId, departmentName, initial, initialOpen }: { departmentId: string; departmentName: string; initial: DepartmentSubpagePage; initialOpen?: string | undefined }) {
  const router = useRouter();
  const interactive = useInteractive();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  // One subpage open at a time; the rest stay folded to their summary (the
  // user, 2026-09-30). The open one is kept in the URL so a reload, or the
  // refresh after each save, leaves the manager where they were.
  const [openId, setOpenId] = useState<string | null>(() =>
    initial.subpages.some((subpage) => subpage.id === initialOpen) ? initialOpen! : initial.subpages.length === 1 ? initial.subpages[0]!.id : null,
  );

  function open(id: string | null) {
    setOpenId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("open", id);
    else url.searchParams.delete("open");
    window.history.replaceState(null, "", url);
  }

  async function mutate(path: string, method: string, body: Record<string, unknown>, key: string) {
    setBusy(key);
    setMessage(null);
    try {
      const response = await fetch(path, { method, credentials: "same-origin", headers: { "content-type": "application/json", ...csrfHeaders() }, body: JSON.stringify({ clientMutationId: newMutationId(), ...body }) });
      const payload = await response.json().catch(() => null) as { message?: string; result?: { subpageId?: string } } | null;
      if (!response.ok) { setMessage({ tone: "danger", text: payload?.message ?? "設定儲存失敗，請重新整理後再試。" }); return null; }
      setMessage({ tone: "success", text: "設定已儲存並立即生效。" });
      router.refresh();
      return payload ?? {};
    } catch { setMessage({ tone: "danger", text: "無法連線到伺服器，請檢查網路後再試。" }); return null; }
    finally { setBusy(null); }
  }

  return <>
    {message ? <Alert tone={message.tone} title={message.tone === "success" ? "已完成" : "無法儲存"} assertive={message.tone === "danger"}>{message.text}</Alert> : null}
    <Alert tone="warning" title="身分權限變更會立即生效">訂單人員與員工的舊個別授權已不再生效。授予身分權限後，該部門持有此身分的使用者都會取得相同權限；取消查看會讓目前開啟的生產單失去存取權。主管固定保有完整權限。</Alert>
    <Card header={<h2 className="cc-h3">新增子分頁</h2>}>
      <div className="cc-row" style={{ alignItems: "end" }}><div className="cc-field" style={{ flex: "1 1 16rem" }}><label className="cc-label" htmlFor="new-subpage">子分頁名稱</label><input id="new-subpage" className="cc-input" value={name} maxLength={80} disabled={!!busy} onChange={(event) => setName(event.target.value)} placeholder="例如：大分條" /></div><Button variant="primary" disabled={!interactive || !!busy || !name.trim()} loading={busy === "create"} loadingLabel="建立中…" onClick={async () => {
        const created = await mutate(`/api/departments/${departmentId}/subpages`, "POST", { name: name.trim() }, "create");
        if (!created) return;
        setName("");
        // A new subpage opens no forms and no identities, so it is the one
        // the manager needs next.
        if (created.result?.subpageId) open(created.result.subpageId);
      }}>新增子分頁</Button></div>
      <p className="cc-help">新子分頁不會預先開放任何表單或非主管身分；建立後請設定。</p>
    </Card>
    {initial.subpages.length === 0 ? <Card><div className="cc-empty"><p className="cc-empty__title">尚無子分頁</p><p className="cc-empty__text">新增第一個子分頁後，才能建立生產單及放入轉入的生產單。</p></div></Card> : initial.subpages.map((subpage, index) => <SubpageCard key={`${subpage.id}-${subpage.revision}`} departmentId={departmentId} departmentName={departmentName} subpage={subpage} templates={initial.eligibleTemplates} index={index} count={initial.subpages.length} busy={busy} interactive={interactive} mutate={mutate} expanded={openId === subpage.id} onToggle={() => open(openId === subpage.id ? null : subpage.id)} />)}
  </>;
}

function SubpageCard({ departmentId, departmentName, subpage, templates, index, count, busy, interactive, mutate, expanded, onToggle }: {
  departmentId: string; departmentName: string; subpage: DepartmentSubpageView; templates: DepartmentSubpagePage["eligibleTemplates"];
  index: number; count: number; busy: string | null; interactive: boolean;
  mutate: (path: string, method: string, body: Record<string, unknown>, key: string) => Promise<unknown>;
  expanded: boolean; onToggle: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(subpage.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [permissions, setPermissions] = useState<SubpageIdentityPermission[]>(identityKinds.map((kind) => subpage.identityPermissions.find((permission) => permission.kind === kind) ?? emptyPermission(kind)));
  const [templateIds, setTemplateIds] = useState<string[]>(subpage.enabledTemplateIds.filter((id) => templates.some((template) => template.id === id)));
  const unavailableSelections = subpage.enabledTemplateIds.filter((id) => !templates.some((template) => template.id === id)).length;
  const base = `/api/departments/${departmentId}/subpages/${subpage.id}`;
  const disabled = !interactive || !!busy;
  const removedTemplates = subpage.enabledTemplateIds.some((id) => templates.some((template) => template.id === id) && !templateIds.includes(id));
  const revokedView = permissions.some((permission) => subpage.identityPermissions.find((previous) => previous.kind === permission.kind)?.canView && !permission.canView);
  // What is saved, for the folded summary and for spotting unsaved changes,
  // which folding keeps rather than discards.
  const saved = identityKinds.map((kind) => subpage.identityPermissions.find((permission) => permission.kind === kind) ?? emptyPermission(kind));
  const savedTemplates = subpage.enabledTemplateIds.filter((id) => templates.some((template) => template.id === id));
  const unsaved = permissions.some((permission, at) => permissionKeys.some((key) => permission[key] !== saved[at]![key]))
    || templateIds.length !== savedTemplates.length || templateIds.some((id) => !savedTemplates.includes(id));
  const grants = identityKinds.map((kind, at) => {
    const granted = permissionKeys.filter((key) => saved[at]![key]).map((key) => labels[key]);
    return `${membershipKindLabels[kind]}：${granted.length > 0 ? granted.join("、") : "未開放"}`;
  }).join("・");
  const bodyId = `subpage-settings-${subpage.id}`;

  function toggle(kind: IdentityKind, key: PermissionKey, checked: boolean) {
    setPermissions((items) => items.map((permission) => {
      if (permission.kind !== kind) return permission;
      const next = { ...permission, [key]: checked };
      if (key === "canView" && !checked) { next.canCreate = false; next.canEdit = false; next.canSubmit = false; }
      if (key !== "canView" && checked) next.canView = true;
      return next;
    }));
  }

  const choice = (kind: IdentityKind, key: PermissionKey) => <label className="cc-choice cc-permission-choice" key={key}><input type="checkbox" checked={permissions.find((permission) => permission.kind === kind)?.[key] ?? false} disabled={disabled} aria-label={`${subpage.name}・${membershipKindLabels[kind]}・${labels[key]}`} onChange={(event) => toggle(kind, key, event.target.checked)} /><span className="cc-only-narrow">{labels[key]}</span></label>;

  return <section className="cc-card cc-fold" aria-label={subpage.name}>
    <div className="cc-card__header"><div className="cc-page__header cc-fold__head"><div className="cc-fold__summary">
      {editing ? <input className="cc-input" aria-label={`${subpage.name} 新名稱`} value={name} maxLength={80} disabled={disabled} onChange={(event) => setName(event.target.value)} /> : <div className="cc-row" style={{ gap: "var(--cc-space-2)" }}>
        <h2 className="cc-h3"><button type="button" className="cc-fold__toggle" aria-expanded={expanded} aria-controls={bodyId} disabled={!interactive} onClick={onToggle}><svg className="cc-fold__chevron" aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>{subpage.name}</button></h2>
        {unsaved ? <Badge tone="warning">尚未儲存</Badge> : null}
      </div>}
      <p className="cc-caption cc-muted">{departmentName}・目前 {subpage.sheetCount} 張生產單・{savedTemplates.length} 個可使用表單・修訂 {subpage.revision}</p>
      <p className="cc-caption cc-muted">{grants}</p>
    </div>{expanded || editing ? <div className="cc-row">{editing ? <><Button variant="primary" disabled={disabled || !name.trim()} loading={busy === `rename-${subpage.id}`} loadingLabel="儲存中…" onClick={async () => { if (await mutate(base, "PATCH", { revision: subpage.revision, name: name.trim() }, `rename-${subpage.id}`)) setEditing(false); }}>儲存名稱</Button><Button variant="secondary" disabled={disabled} onClick={() => { setName(subpage.name); setEditing(false); }}>取消</Button></> : <><Button variant="secondary" disabled={disabled || index === 0} loading={busy === `up-${subpage.id}`} loadingLabel="移動中…" onClick={() => void mutate(base, "PATCH", { revision: subpage.revision, position: index - 1 }, `up-${subpage.id}`)}>上移<span className="cc-sr-only"> {subpage.name}</span></Button><Button variant="secondary" disabled={disabled || index === count - 1} loading={busy === `down-${subpage.id}`} loadingLabel="移動中…" onClick={() => void mutate(base, "PATCH", { revision: subpage.revision, position: index + 1 }, `down-${subpage.id}`)}>下移<span className="cc-sr-only"> {subpage.name}</span></Button><Button variant="secondary" disabled={disabled} onClick={() => setEditing(true)}>重新命名</Button></>}</div> : null}</div></div>
    <div className="cc-card__body" id={bodyId} hidden={!expanded}><div className="cc-stack">
      <section aria-labelledby={`identity-title-${subpage.id}`} className="cc-stack"><div><h3 className="cc-h3" id={`identity-title-${subpage.id}`}>部門身分權限</h3><p className="cc-body-sm cc-secondary">主管固定保有完整權限。訂單人員與員工可各自設定；同時擁有兩種身分的使用者會合併權限。</p></div>
        {revokedView ? <Alert tone="warning" title="將撤銷目前存取權">儲存後，該身分的使用者可能立即失去此子分頁及其中生產單的查看權限。</Alert> : null}
        <div className="cc-only-wide"><ScrollRegion label={`${subpage.name} 身分權限`}><table className="cc-table"><thead><tr><th scope="col">身分</th>{permissionKeys.map((key) => <th scope="col" key={key}>{labels[key]}</th>)}</tr></thead><tbody><tr><th scope="row">主管</th><td colSpan={4}>完整權限（固定）</td></tr>{identityKinds.map((kind) => <tr key={kind}><th scope="row">{membershipKindLabels[kind]}</th>{permissionKeys.map((key) => <td key={key}>{choice(kind, key)}</td>)}</tr>)}</tbody></table></ScrollRegion></div>
        <div className="cc-only-narrow cc-stack"><div className="cc-permission-card"><strong>主管</strong><p className="cc-body-sm cc-muted">完整權限（固定）</p></div>{identityKinds.map((kind) => <div className="cc-permission-card" key={kind}><strong>{membershipKindLabels[kind]}</strong><div className="cc-row">{permissionKeys.map((key) => choice(kind, key))}</div></div>)}</div>
        <div className="cc-row"><Button variant="primary" disabled={disabled} loading={busy === `identities-${subpage.id}`} loadingLabel="儲存中…" onClick={() => void mutate(`${base}/identities`, "PUT", { revision: subpage.revision, permissions }, `identities-${subpage.id}`)}>儲存身分權限</Button></div>
      </section>
      <section aria-labelledby={`templates-title-${subpage.id}`} className="cc-stack"><div><h3 className="cc-h3" id={`templates-title-${subpage.id}`}>可使用的表單</h3><p className="cc-body-sm cc-secondary">只有勾選的表單可以在此子分頁建立或移入，並由訂單人員與員工作業。主管不受此限制。</p></div>
        {unavailableSelections > 0 ? <Alert tone="warning" title="有已停用的表單">{unavailableSelections} 個先前選取的表單已無法建立，儲存此清單時會移除該選取；既有生產單不受影響。</Alert> : null}
        {removedTemplates ? <Alert tone="warning" title="將停止使用部分表單">儲存後，此子分頁中取消勾選之表單的生產單只能檢視，直到主管將它們移到已勾選的子分頁或重新勾選。</Alert> : null}
        {templates.length === 0 ? <p className="cc-body-sm cc-muted">目前沒有此部門可建立的已發布表單。</p> : <div className="cc-stack">{templates.map((template) => <label className="cc-choice" key={template.id}><input type="checkbox" checked={templateIds.includes(template.id)} disabled={disabled} aria-label={`${subpage.name}・${template.displayName}`} onChange={(event) => setTemplateIds((current) => event.target.checked ? [...current, template.id] : current.filter((id) => id !== template.id))} /><span>{template.displayName}<span className="cc-caption cc-muted">・{template.documentCode}・版本 {template.version}</span></span></label>)}</div>}
        <div className="cc-row"><Button variant="secondary" disabled={disabled} loading={busy === `templates-${subpage.id}`} loadingLabel="儲存中…" onClick={() => void mutate(`${base}/templates`, "PUT", { revision: subpage.revision, templateIds }, `templates-${subpage.id}`)}>儲存可使用表單</Button></div>
      </section>
      <div className="cc-row">{confirmDelete ? <><span className="cc-body-sm">確定永久刪除？只有沒有生產單的子分頁可以刪除。</span><Button variant="danger" disabled={disabled} loading={busy === `delete-${subpage.id}`} loadingLabel="刪除中…" onClick={() => void mutate(base, "DELETE", { revision: subpage.revision }, `delete-${subpage.id}`)}>確定刪除</Button><Button variant="secondary" disabled={disabled} onClick={() => setConfirmDelete(false)}>取消</Button></> : <Button variant="danger-quiet" disabled={disabled} onClick={() => setConfirmDelete(true)}>刪除子分頁</Button>}</div>
    </div></div>
  </section>;
}
