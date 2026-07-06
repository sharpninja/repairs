// GitHub side: branch off the base, edit docs/marketplace.json, open a PR.
// Uses a server-held credential (GITHUB_TOKEN) — a fine-grained PAT with
// "Contents" + "Pull requests" read/write on the target repo, or a GitHub App
// installation token. Users never see or hold this credential.
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { readFileSync } from "node:fs";
import { moderatePullRequest } from "./moderate.js";

const OWNER = process.env.GITHUB_OWNER || "sharpninja";
const REPO = process.env.GITHUB_REPO || "repairs";
const BASE = process.env.GITHUB_BASE || "main";
const FILE = process.env.MARKETPLACE_PATH || "docs/marketplace.json";
const SUBMISSION_LABEL = process.env.SUBMISSION_LABEL || "app-submission";

// Label the PR as an app submission and (unless disabled) kick off Claude
// moderation immediately. Fire-and-forget so the RPC returns fast; the monitor
// process is the backstop for anything missed.
async function afterPR(kit, prNumber, submitter) {
  try { await kit.issues.addLabels({ owner: OWNER, repo: REPO, issue_number: prNumber, labels: [SUBMISSION_LABEL] }); } catch (e) {}
  if (process.env.MODERATE_ON_SUBMIT !== "false") {
    moderatePullRequest(kit, OWNER, REPO, prNumber, { submitter }).catch((e) => console.error("inline moderation #" + prNumber + ":", e.message));
  }
}

function appPrivateKey() {
  const f = process.env.GITHUB_APP_PRIVATE_KEY_FILE;
  if (f) return readFileSync(f, "utf8");
  const k = process.env.GITHUB_APP_PRIVATE_KEY;
  return k ? k.replace(/\\n/g, "\n") : "";
}
// Prefer GitHub App auth (installation tokens are least-privilege — limited to the
// App's configured permissions — and auto-refresh, so nothing hourly-expiring is
// baked in). Fall back to a GITHUB_TOKEN (PAT or a minted installation token).
function octo() {
  const appId = process.env.GITHUB_APP_ID;
  const key = appPrivateKey();
  const inst = process.env.GITHUB_APP_INSTALLATION_ID;
  if (appId && key && inst) {
    return new Octokit({ authStrategy: createAppAuth, auth: { appId, privateKey: key, installationId: Number(inst) } });
  }
  const t = process.env.GITHUB_TOKEN;
  if (!t) throw new Error("Set GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY + GITHUB_APP_INSTALLATION_ID, or GITHUB_TOKEN");
  return new Octokit({ auth: t });
}
const slug = (s) => String(s || "guide").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "guide";
const stamp = () => new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);

async function loadCatalog(kit, ref) {
  const r = await kit.repos.getContent({ owner: OWNER, repo: REPO, path: FILE, ref });
  const json = Buffer.from(r.data.content, "base64").toString("utf8");
  return { sha: r.data.sha, catalog: JSON.parse(json) };
}
async function branchFrom(kit) {
  const base = await kit.git.getRef({ owner: OWNER, repo: REPO, ref: `heads/${BASE}` });
  const name = `submit/${stamp()}-${Math.random().toString(36).slice(2, 7)}`;
  await kit.git.createRef({ owner: OWNER, repo: REPO, ref: `refs/heads/${name}`, sha: base.data.object.sha });
  return name;
}
async function putCatalog(kit, branch, sha, catalog, message) {
  const content = Buffer.from(JSON.stringify(catalog, null, 2) + "\n", "utf8").toString("base64");
  await kit.repos.createOrUpdateFileContents({ owner: OWNER, repo: REPO, path: FILE, message, content, sha, branch });
}

export async function openReviewPR({ user, guideId, guideTitle, stars, text }) {
  const kit = octo();
  const branch = await branchFrom(kit);
  const { sha, catalog } = await loadCatalog(kit, branch);
  const entry = (catalog.guides || []).find((g) => g.id === guideId);
  if (!entry) throw new Error("Unknown guide id: " + guideId);
  entry.reviews = entry.reviews || [];
  entry.reviews.push({ author: user.email, stars, text, ts: Date.now(), source: "app" });
  const rated = entry.reviews.filter((r) => typeof r.stars === "number");
  if (rated.length) {
    entry.rating = { avg: Number((rated.reduce((a, b) => a + b.stars, 0) / rated.length).toFixed(2)), count: rated.length };
  }
  await putCatalog(kit, branch, sha, catalog, `Add review for ${guideTitle} (${user.email})`);
  const pr = await kit.pulls.create({
    owner: OWNER, repo: REPO, base: BASE, head: branch,
    title: `Review: ${guideTitle} (${stars}★)`,
    body: `Submitted from the app by **${user.name || user.email}** (${user.email}).\n\n` +
      `Guide: \`${guideId}\`\nRating: ${stars}★\n\n> ${String(text).replace(/\n/g, "\n> ")}\n\n` +
      `_Claude moderation runs automatically; please verify before merging._`,
  });
  await afterPR(kit, pr.data.number, user.email);
  return pr.data;
}

export async function getStatuses(numbers) {
  const kit = octo();
  const out = [];
  for (const n of (numbers || []).slice(0, 50)) {
    try {
      const pr = (await kit.pulls.get({ owner: OWNER, repo: REPO, pull_number: n })).data;
      out.push({ number: n, state: pr.state, merged: !!pr.merged_at, url: pr.html_url, title: pr.title });
    } catch (e) {
      out.push({ number: n, state: "unknown", merged: false, url: "", title: "" });
    }
  }
  return out;
}

export async function openRepairPR({ user, guide }) {
  const kit = octo();
  const branch = await branchFrom(kit);
  const { sha, catalog } = await loadCatalog(kit, branch);
  const id = `mkt-${slug(guide.title)}-${stamp()}`;
  catalog.guides = catalog.guides || [];
  catalog.guides.push({ id, guide, rating: { avg: 0, count: 0 }, reviews: [], submittedBy: user.email, submittedAt: Date.now() });
  await putCatalog(kit, branch, sha, catalog, `Add community guide: ${guide.title} (${user.email})`);
  const pr = await kit.pulls.create({
    owner: OWNER, repo: REPO, base: BASE, head: branch,
    title: `New guide: ${guide.title}`,
    body: `Community guide submitted from the app by **${user.name || user.email}** (${user.email}).\n\n` +
      `Catalog id: \`${id}\`\nPhases: ${(guide.phases || []).map((p) => p.name).join(" · ")}\n\n` +
      `⚠️ Review for safety and accuracy before merging.`,
  });
  await afterPR(kit, pr.data.number, user.email);
  return pr.data;
}
