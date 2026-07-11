// HTTP server exposing the SubmissionService over Connect + gRPC-Web.
// A CORS shim lets the browser PWA (a different origin) call it directly.
import http from "node:http";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import routes from "./routes.js";
import { adminHandler } from "./admin.js";
import { legalHandler } from "./legal.js";
import { handleGoogleCallback, handleGoogleRedeem } from "./oauth.js";

// CORS allowlist: a comma-separated list of exact origins, or "*" to allow any.
// With a list, the matching request Origin is echoed back (proper multi-origin CORS);
// lock this down to your published origin(s) before go-live.
const ALLOW = (process.env.ALLOWED_ORIGIN || "*").split(",").map((s) => s.trim()).filter(Boolean);
const ALLOW_ANY = ALLOW.includes("*");
const originFor = (req) => ALLOW_ANY ? "*" : (ALLOW.includes(req.headers.origin) ? req.headers.origin : (ALLOW[0] || ""));
const PORT = process.env.PORT || 8080;

const adapter = connectNodeAdapter({ routes });

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", originFor(req));
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Connect-Protocol-Version, Connect-Timeout-Ms, X-Grpc-Web, X-User-Agent, Grpc-Timeout"
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
  // Token-gated admin dashboard (moderation status/logs + error logs + bans).
  if (req.method === "GET" && req.url.split("?")[0] === "/admin") {
    adminHandler(req, res).catch(() => { try { res.writeHead(500, { "content-type": "text/plain" }); res.end("error"); } catch (e) {} });
    return;
  }
  // Public legal pages (privacy policy + terms) for the app-store listings.
  if (legalHandler(req, res)) return;
  // Top-level redirect Google sign-in. The callback is a browser form POST from Google
  // (the Connect/gRPC-Web adapter can't parse it), so intercept both before the adapter.
  const path = req.url.split("?")[0];
  if (req.method === "POST" && path === "/auth/google/callback") {
    handleGoogleCallback(req, res).catch(() => { try { res.writeHead(500, { "content-type": "text/plain" }); res.end("error"); } catch (e) {} });
    return;
  }
  if (req.method === "POST" && path === "/auth/google/redeem") {
    handleGoogleRedeem(req, res).catch(() => { try { res.writeHead(500, { "content-type": "text/plain" }); res.end("error"); } catch (e) {} });
    return;
  }
  adapter(req, res);
});

server.listen(PORT, () => console.log(`repairs-submit-service listening on :${PORT}`));
