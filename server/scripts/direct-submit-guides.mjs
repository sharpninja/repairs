#!/usr/bin/env node
import { readFileSync } from "node:fs";

const DEFAULT_ENDPOINT = process.env.SUBMIT_API || process.env.REPAIRS_SUBMIT_API || "https://sharpninja.ngrok.app";

function usage() {
  console.error(`Usage:
  DIRECT_SUBMIT_BEARER_TOKEN=... npm run submit-direct -- --catalog ../docs/marketplace.json --filter '^mkt-roadside-'
  DIRECT_SUBMIT_BEARER_TOKEN=... npm run submit-direct -- guide.json

Options:
  --endpoint <url>   Submit service base URL. Default: ${DEFAULT_ENDPOINT}
  --catalog <path>   Read a marketplace catalog and submit matching entry.guide objects.
  --filter <regex>   Filter catalog entries by entry id.
  --help             Show this help.

The bearer token is read from DIRECT_SUBMIT_BEARER_TOKEN. It is never printed.`);
}

function parseArgs(argv) {
  const out = { endpoint: DEFAULT_ENDPOINT, files: [], catalog: "", filter: "" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--endpoint") out.endpoint = argv[++i] || "";
    else if (arg === "--catalog") out.catalog = argv[++i] || "";
    else if (arg === "--filter") out.filter = argv[++i] || "";
    else out.files.push(arg);
  }
  return out;
}

function loadGuidesFromFile(file) {
  const json = JSON.parse(readFileSync(file, "utf8"));
  if (json && typeof json.title === "string" && Array.isArray(json.phases)) return [{ label: file, guide: json }];
  if (json && Array.isArray(json.guides)) {
    return json.guides.filter((entry) => entry && entry.guide).map((entry) => ({ label: entry.id || file, guide: entry.guide }));
  }
  throw new Error(`${file} is neither a guide export nor a marketplace catalog`);
}

function loadCatalogGuides(file, filter) {
  const catalog = JSON.parse(readFileSync(file, "utf8"));
  if (!catalog || !Array.isArray(catalog.guides)) throw new Error(`${file} is not a marketplace catalog`);
  const re = filter ? new RegExp(filter) : null;
  return catalog.guides
    .filter((entry) => entry && entry.guide && (!re || re.test(entry.id || "")))
    .map((entry) => ({ label: entry.id || entry.guide.title, guide: entry.guide }));
}

async function submitBatch(endpoint, token, items) {
  const url = endpoint.replace(/\/+$/, "") + "/repairs.v1.SubmissionService/SubmitRepair";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ guideJson: JSON.stringify(items.map((item) => item.guide)) }),
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { message: text }; }
  if (!res.ok || !data.ok) throw new Error(data.message || `HTTP ${res.status}`);
  console.log(`${items.length} guide${items.length === 1 ? "" : "s"}: ${data.prNumber ? `PR #${data.prNumber} ${data.prUrl}` : data.message}`);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  usage();
  process.exit(0);
}

const token = process.env.DIRECT_SUBMIT_BEARER_TOKEN || "";
if (!args.endpoint) {
  usage();
  throw new Error("Missing submit endpoint");
}
if (!token) {
  usage();
  throw new Error("Missing DIRECT_SUBMIT_BEARER_TOKEN");
}

let items = [];
if (args.catalog) items = items.concat(loadCatalogGuides(args.catalog, args.filter));
for (const file of args.files) items = items.concat(loadGuidesFromFile(file));
if (!items.length) {
  usage();
  throw new Error("No guides selected");
}

await submitBatch(args.endpoint, token, items);
