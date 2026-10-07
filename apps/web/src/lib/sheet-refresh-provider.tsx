"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { SheetRefreshCoordinator } from "./sheet-refresh";

type ScheduleSheetRefresh = () => void;

const SheetRefreshContext = createContext<ScheduleSheetRefresh | null>(null);

/** Owns the single refresh transition shared by every client on a sheet page. */
export function SheetRefreshProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const coordinatorRef = useRef<SheetRefreshCoordinator | null>(null);
  const transitionStartedRef = useRef(false);
  const pendingObservedRef = useRef(false);

  if (!coordinatorRef.current) {
    coordinatorRef.current = new SheetRefreshCoordinator();
  }
  // Record this during render rather than waiting for an effect. Under load,
  // the two-frame synchronous-refresh fallback must not mistake a real pending
  // navigation for one that completed immediately.
  if (isPending) pendingObservedRef.current = true;

  const schedule = useCallback(() => {
    coordinatorRef.current?.schedule(() => {
      transitionStartedRef.current = true;
      pendingObservedRef.current = false;
      startTransition(() => router.refresh());

      // React normally exposes the navigation through `isPending`. If a
      // refresh is fulfilled synchronously and never produces a pending render,
      // release the coordinator after the browser has had a chance to commit.
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (transitionStartedRef.current && !pendingObservedRef.current) {
            transitionStartedRef.current = false;
            coordinatorRef.current?.settle();
          }
        });
      });
    });
  }, [router, startTransition]);

  useEffect(() => {
    if (isPending) {
      pendingObservedRef.current = true;
      return;
    }
    if (!transitionStartedRef.current || !pendingObservedRef.current) return;

    transitionStartedRef.current = false;
    coordinatorRef.current?.settle();
  }, [isPending]);

  useEffect(
    () => () => {
      coordinatorRef.current?.dispose();
      // Do not clear the ref here. React development Strict Mode replays
      // effect cleanup without remounting or re-rendering this provider; a
      // null ref would therefore make every later schedule request a no-op.
      // A real unmount discards the component ref itself.
    },
    [],
  );

  return (
    <SheetRefreshContext.Provider value={schedule}>
      {children}
    </SheetRefreshContext.Provider>
  );
}

export function useSheetRefresh(): ScheduleSheetRefresh {
  const schedule = useContext(SheetRefreshContext);
  if (!schedule) {
    throw new Error("useSheetRefresh must be used inside SheetRefreshProvider");
  }
  return schedule;
}
