export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(
    { status: "ok", service: "workflow-web", timestamp: new Date().toISOString() },
    { headers: { "cache-control": "no-store" } },
  );
}
