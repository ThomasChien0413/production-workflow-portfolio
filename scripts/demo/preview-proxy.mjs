import http from "node:http";

// Local capture/test router only. Fixed loopback targets, no credentials or
// deployment configuration; HTTP and upgrade bodies stream without buffering.
const server = http.createServer((request, response) => {
  const upstream = http.request({ hostname: "127.0.0.1", port: request.url?.startsWith("/api/") ? 3331 : 3340,
    path: request.url, method: request.method, headers: request.headers }, incoming => {
    response.writeHead(incoming.statusCode ?? 502, incoming.headers);
    incoming.pipe(response);
  });
  upstream.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end("Local preview unavailable"); });
  request.pipe(upstream);
});
server.on("upgrade", (request, socket, head) => {
  const port = request.url === "/api/ws" ? 3331 : request.url?.startsWith("/_next/hmr") ? 3340 : null;
  if (port === null) { socket.destroy(); return; }
  const upstream = http.request({ hostname: "127.0.0.1", port, path: request.url, headers: request.headers });
  upstream.on("upgrade", (response, target, upstreamHead) => {
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([name, value]) => `${name}: ${value}`).join("\r\n")}\r\n\r\n`);
    if (head.length) target.write(head);
    if (upstreamHead.length) socket.write(upstreamHead);
    socket.pipe(target); target.pipe(socket);
    socket.on("error", () => target.destroy()); target.on("error", () => socket.destroy());
    socket.on("close", () => target.destroy()); target.on("close", () => socket.destroy());
  });
  upstream.on("error", () => socket.destroy());
  upstream.on("response", () => socket.destroy());
  upstream.end();
});
server.listen(3330, "127.0.0.1", () => console.log("Isolated preview router: http://localhost:3330 (web 3340, API 3331)"));
