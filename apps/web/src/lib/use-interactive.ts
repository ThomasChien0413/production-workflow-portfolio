"use client";

import { useEffect, useState } from "react";

/**
 * Whether React has taken over this component's controls.
 *
 * A sheet action button carries no form action, only an `onClick`. Between the
 * server-rendered HTML appearing and hydration attaching that handler, the
 * button looks completely ready and does nothing at all — a tap in that window
 * is swallowed with no request, no error and no feedback.
 *
 * That window is not theoretical and it is not only a test problem. A CI trace
 * of the reviewer's browser shows thirty-eight requests, every one a page
 * asset, and no approve request: the 核准 press landed before hydration, so the
 * sheet stayed at 待業務審核. The symptom — a status badge one state behind —
 * sent three separate fixes into the refresh machinery before the trace showed
 * the state had never changed, because the decision had never been sent.
 *
 * So a control that cannot act yet is disabled until it can. It says "not yet"
 * rather than pretending, which is the honest thing to show an operator on a
 * slow tablet and the signal a test can wait on instead of clicking hopefully.
 */
export function useInteractive(): boolean {
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  return interactive;
}
