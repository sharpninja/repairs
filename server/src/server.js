// HTTP server exposing the SubmissionService over Connect + gRPC-Web.
// A CORS shim lets the browser PWA (a different origin) call it directly.
import http from "node:http";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import routes from "./routes.js";

const ALLOW = process.env.ALLOWED_ORIGIN || "*";
const PORT = process.env.PORT || 8080;

const adapter = connectNodeAdapter({ routes });

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOW);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Connect-Protocol-Version, Connect-Timeout-Ms, X-Grpc-Web, X-User-Agent, Grpc-Timeout"
  );
  res.setHeader("Access-Control-Expose-Headers", "Grpc-Status, Grpc-Message");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  // Lightweight health check for container orchestrators.
  if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  adapter(req, res);
});

server.listen(PORT, () => console.log(`repairs-submit-service listening on :${PORT}`));
