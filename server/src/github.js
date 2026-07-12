// GitHub side: branch off the base, edit docs/marketplace.json, open a PR.
// Uses a server-held credential (GITHUB_TOKEN) — a fine-grained PAT with
// "Contents" + "Pull requests" read/write on the target repo, or a GitHub App
// installation token. Users never see or hold this credential.
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { readFileSync } from "node:fs";
import { mergeApprovedPR, moderatePullRequest } from "./moderate.js";

// Data lives in a separate repo, published on its "approved" branch. Submissions
// open PRs against that branch; merging publishes to what the app reads.
const OWNER = process.env.GITHUB_OWNER || "sharpninja";
const REPO = process.env.GITHUB_REPO || "repairs-data";
const BASE = process.env.GITHUB_BASE || "approved";
const FILE = process.env.MARKETPLACE_PATH || "marketplace.json";
const SUBMISSION_LABEL = process.env.SUBMISSION_LABEL || "app-submission";

function cloneJson(value) {
  return value == null ? {} : JSON.parse(JSON.stringify(value));
}

function reviewKey(review) {
  return JSON.stringify({
    author: (review && review.author) || "",
    stars: review && review.stars,
    text: (review && review.text) || "",
    ts: (review && review.ts) || 0,
    source: (review && review.source) || "",
  });
}

function refreshRating(entry) {
  const rated = (entry.reviews || []).filter((review) => typeof review.stars === "number");
  if (rated.length) {
    entry.rating = {
      avg: Number((rated.reduce((sum, review) => sum + review.stars, 0) / rated.length).toFixed(2)),
      count: rated.length,
    };
  }
}

export function mergeCatalogDelta(baseCatalog, proposedCatalog) {
  const merged = cloneJson(baseCatalog);
  merged.guides = Array.isArray(merged.guides) ? merged.guides : [];
  const byId = new Map(merged.guides.filter((guide) => guide && guide.id).map((guide) => [guide.id, guide]));
  const proposedGuides = Array.isArray(proposedCatalog && proposedCatalog.guides) ? proposedCatalog.guides : [];
  let changed = 0;

  for (const proposedGuide of proposedGuides) {
    if (!proposedGuide || !proposedGuide.id) continue;
    const existing = byId.get(proposedGuide.id);
    if (!existing) {
      const copy = cloneJson(proposedGuide);
      merged.guides.push(copy);
      byId.set(copy.id, copy);
      changed++;
      continue;
    }

    const existingReviews = Array.isArray(existing.reviews) ? existing.reviews : [];
    const proposedReviews = Array.isArray(proposedGuide.reviews) ? proposedGuide.reviews : [];
    const seen = new Set(existingReviews.map(reviewKey));
    let addedReviews = 0;
    for (const review of proposedReviews) {
      const key = reviewKey(review);
      if (seen.has(key)) continue;
      existingReviews.push(cloneJson(review));
      seen.add(key);
      addedReviews++;
    }
    if (addedReviews) {
      existing.reviews = existingReviews;
      refreshRating(existing);
      changed += addedReviews;
    }
  }

  return { catalog: merged, changed };
}

function mergeConflictError(error) {
  return /merge conflicts/i.test(String(error || ""));
}

async function commentBatchMergeFailed(kit, owner, repo, prNumber, error) {
  try {
    await kit.issues.createComment({
      owner, repo, issue_number: prNumber,
      body: `<!-- ai-auto-merge -->\n### ⚠️ Auto-merge failed\n\nThe approved PR could not be merged automatically: ${error}\n\nA maintainer should resolve the merge failure and merge manually if appropriate.`,
    });
  } catch (_) {}
}

async function resolveGeneratedCatalogConflict(kit, owner, repo, pr, firstError) {
  if (!mergeConflictError(firstError)) {
    return { status: "failed", error: firstError || "merge failed", commented: false };
  }

  try {
    const detail = (await kit.pulls.get({ owner, repo, pull_number: pr.number })).data;
    const expectedRepo = `${owner}/${repo}`.toLowerCase();
    const headRepo = String(detail.head?.repo?.full_name || "").toLowerCase();
    if (headRepo !== expectedRepo) {
      return { status: "failed", error: "Cannot update conflicted PR branch outside the data repository.", commented: false };
    }

    const base = await loadCatalog(kit, detail.base?.ref || BASE);
    const head = await loadCatalog(kit, detail.head.ref);
    const merged = mergeCatalogDelta(base.catalog, head.catalog);
    if (!merged.changed) {
      return { status: "failed", error: "Conflicted PR did not contain new catalog entries or reviews to apply.", commented: false };
    }

    await putCatalog(kit, detail.head.ref, head.sha, merged.catalog, `Resolve generated catalog conflict for PR #${pr.number}`);
    const retry = await mergeApprovedPR(kit, owner, repo, pr.number);
    if (retry.status === "merged") {
      return { ...retry, mode: "catalog-conflict-resolved", changed: merged.changed, commented: false };
    }
    return {
      ...retry,
      error: `Resolved generated catalog conflict, but merge still failed: ${retry.error || "unknown error"}`,
      mode: "catalog-conflict-resolved",
      changed: merged.changed,
      commented: true,
    };
  } catch (e) {
    return { status: "failed", error: String((e && e.message) || e || "unknown error").slice(0, 500), commented: false };
  }
}

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

// List open app-submission PRs + their current moderation verdict (from the ai:*
// label). Throws if no GitHub credentials are configured (callers treat this as
// best-effort). Used by the admin dashboard's live moderation-status view.
export async function listOpenSubmissionPRs() {
  const kit = octo();
  const prs = await kit.pulls.list({ owner: OWNER, repo: REPO, state: "open", per_page: 50, sort: "created", direction: "desc" });
  return prs.data
    .filter((pr) => (pr.labels || []).some((l) => l.name === SUBMISSION_LABEL))
    .map((pr) => {
      const labels = (pr.labels || []).map((l) => l.name);
      return {
        number: pr.number, title: pr.title, state: pr.state, url: pr.html_url,
        verdict: (labels.find((l) => l.startsWith("ai:")) || "").replace("ai:", "") || "pending",
        injection: labels.includes("prompt-injection"),
      };
    });
}

export async function mergeApprovedSubmissionPRs() {
  const kit = octo();
  const prs = await kit.pulls.list({ owner: OWNER, repo: REPO, state: "open", per_page: 50, sort: "created", direction: "desc" });
  const approved = prs.data.filter((pr) => {
    const labels = (pr.labels || []).map((l) => l.name);
    return labels.includes(SUBMISSION_LABEL) && labels.includes("ai:approve");
  });
  const results = [];
  for (const pr of approved) {
    let result = await mergeApprovedPR(kit, OWNER, REPO, pr.number, { comment: false });
    if (result.status !== "merged") {
      result = await resolveGeneratedCatalogConflict(kit, OWNER, REPO, pr, result.error);
    }
    if (result.status !== "merged" && !result.commented) {
      await commentBatchMergeFailed(kit, OWNER, REPO, pr.number, result.error || "unknown error");
    }
    results.push({
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      status: result.status,
      error: result.error || "",
      mode: result.mode || "",
    });
  }
  return results;
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

function addGuideEntries(catalog, guides, user) {
  const used = new Set((catalog.guides || []).map((g) => g.id).filter(Boolean));
  const now = Date.now();
  const when = stamp();
  return guides.map((guide, i) => {
    const base = `mkt-${slug(guide.title)}-${when}${guides.length > 1 ? "-" + (i + 1) : ""}`;
    let id = base, n = 2;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
    catalog.guides.push({ id, guide, rating: { avg: 0, count: 0 }, reviews: [], submittedBy: user.email, submittedAt: now });
    return { id, guide };
  });
}

export async function openGuidesPR({ user, guides }) {
  const kit = octo();
  const branch = await branchFrom(kit);
  const { sha, catalog } = await loadCatalog(kit, branch);
  catalog.guides = catalog.guides || [];
  const added = addGuideEntries(catalog, guides, user);
  const one = added.length === 1 ? added[0] : null;
  await putCatalog(kit, branch, sha, catalog, one ? `Add community guide: ${one.guide.title} (${user.email})` : `Add ${added.length} community guides (${user.email})`);
  const pr = await kit.pulls.create({
    owner: OWNER, repo: REPO, base: BASE, head: branch,
    title: one ? `New guide: ${one.guide.title}` : `New guides: ${added.length} roadside guides`,
    body: `Community guide submitted from the app by **${user.name || user.email}** (${user.email}).\n\n` +
      (one
        ? `Catalog id: \`${one.id}\`\nPhases: ${(one.guide.phases || []).map((p) => p.name).join(" · ")}\n\n`
        : added.map((x) => `- \`${x.id}\` — ${x.guide.title}`).join("\n") + "\n\n") +
      `⚠️ Review for safety and accuracy before merging.`,
  });
  await afterPR(kit, pr.data.number, user.email);
  return pr.data;
}

export async function openRepairPR({ user, guide }) {
  return openGuidesPR({ user, guides: [guide] });
}
