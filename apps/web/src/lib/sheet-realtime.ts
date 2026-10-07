"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The sheet's live connection.
 *
 * The server hub (apps/api/src/sheets/realtime.ts) authorizes the room on join
 * and re-checks access before every outbound event, so this client is a
 * consumer only: it joins, listens, and reconnects. It never asserts presence
 * or claims access — anything it says about who is here comes from the server.
 *
 * The merge policy is the load-bearing part. Editing is explicit (DESIGN.md
 * §9.1): values live in the browser until 儲存 is pressed. A remote patch must
 * therefore never overwrite a field the operator has touched — that would
 * silently discard typing in front of them. Fields they have not touched are
 * applied live; fields they have are reported as collisions so they learn about
 * it before they save rather than from a conflict error afterwards.
 */
export type RealtimeStatus =
  | "connecting"
  | "live"
  | "offline"
  | "revoked"
  | "unauthenticated";

export type PresenceUser = { id: string; displayName: string };

type ServerEvent = {
  type: string;
  sheetId?: string;
  sheet?: { version: number; updatedAt: string };
  participants?: PresenceUser[];
  changedFields?: string[];
  canonicalValues?: Record<string, unknown>;
  resyncRequired?: boolean;
  code?: string;
};

export type RealtimeHandlers = {
  /**
   * Canonical values for fields changed by someone else. Returns the field keys
   * the caller refused to apply because they hold unsaved local edits.
   */
  onRemoteValues: (values: Map<string, string>) => string[];
  /** A change this page's server-rendered data does not reflect. */
  onServerStateChanged: () => void;
};

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

export function useSheetRealtime(
  sheetId: string,
  version: number,
  updatedAt: string,
  handlers: RealtimeHandlers,
) {
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const [participants, setParticipants] = useState<PresenceUser[]>([]);
  const [collisions, setCollisions] = useState<string[]>([]);

  // Handlers change on every render of the form; keeping them in a ref stops
  // that from tearing down and reopening the socket.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const socketRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const closedRef = useRef(false);

  const connect = useCallback(() => {
    if (closedRef.current) return;
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      setStatus("offline");
      return;
    }
    socketRef.current = socket;

    // Deliberately no join here. The socket opens before the server has
    // finished authenticating it, and the hub answers an early `sheet.join`
    // with NOT_READY and never puts the connection in the room — so the page
    // looks connected and silently receives nothing. `connection.ready` is the
    // handshake; the join belongs there.
    socket.addEventListener("open", () => {
      attemptRef.current = 0;
    });

    const join = () => {
      socket.send(
        JSON.stringify({
          type: "sheet.join",
          sheetId,
          lastKnownVersion: version,
          lastKnownUpdatedAt: updatedAt,
        }),
      );
    };

    socket.addEventListener("message", (event) => {
      let parsed: ServerEvent;
      try {
        parsed = JSON.parse(String(event.data)) as ServerEvent;
      } catch {
        return;
      }
      if (parsed.sheetId && parsed.sheetId !== sheetId) return;

      switch (parsed.type) {
        case "connection.ready":
          setStatus("live");
          join();
          break;
        case "connection.error":
          // Access can be lost between page load and join — a role change, a
          // 送交 away from this user's department. Anything else is a client
          // bug and is left to the console rather than shown to an operator.
          if (parsed.code === "ACCESS_DENIED") setStatus("revoked");
          break;
        case "sheet.snapshot":
          setStatus("live");
          // The page was rendered from a server fetch that may predate the
          // latest write; the server tells us when that is the case.
          if (parsed.resyncRequired) handlersRef.current.onServerStateChanged();
          break;
        case "presence.snapshot":
        case "presence.changed":
          setParticipants(parsed.participants ?? []);
          break;
        case "sheet.patch.applied": {
          const values = new Map<string, string>();
          for (const [key, value] of Object.entries(parsed.canonicalValues ?? {})) {
            values.set(key, typeof value === "string" ? value : String(value ?? ""));
          }
          const refused = handlersRef.current.onRemoteValues(values);
          if (refused.length > 0) {
            setCollisions((previous) => [...new Set([...previous, ...refused])]);
          }
          break;
        }
        case "sheet.status.changed":
        case "sheet.assignment.changed":
        case "sheet.approval.changed":
          handlersRef.current.onServerStateChanged();
          break;
        case "sheet.attachment.changed":
          window.dispatchEvent(
            new CustomEvent("workflow:sheet-attachment-changed", {
              detail: { sheetId },
            }),
          );
          break;
        case "room.access.revoked":
          setStatus("revoked");
          closedRef.current = true;
          socket.close();
          break;
        default:
          break;
      }
    });

    socket.addEventListener("close", (event) => {
      if (closedRef.current) return;
      // 1008 is the hub's policy code: the session expired or was ended.
      // Reconnecting would fail the same way, so stop and say so.
      if (event.code === 1008) {
        setStatus("unauthenticated");
        closedRef.current = true;
        return;
      }
      setStatus("offline");
      const delay =
        RECONNECT_DELAYS_MS[Math.min(attemptRef.current, RECONNECT_DELAYS_MS.length - 1)] ??
        30_000;
      attemptRef.current += 1;
      window.setTimeout(connect, delay);
    });
  }, [sheetId, updatedAt, version]);

  useEffect(() => {
    closedRef.current = false;
    connect();
    return () => {
      closedRef.current = true;
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [connect]);

  const clearCollisions = useCallback(() => setCollisions([]), []);

  return { status, participants, collisions, clearCollisions };
}
