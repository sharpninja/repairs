// Standalone monitor: polls open submission PRs that Claude hasn't moderated yet
// and moderates them. Runs as its own process/container (npm run monitor) so it
// also catches PRs the service didn't create inline. Uses the Claude Code CLI
// (subscription) via moderate.js.
import { Octokit } from "@octokit/rest";
import { moderatePullRequest } from "./moderate.js";

const OWNER = process.env.GITHUB_OWNER || "sharpninja";
const REPO = process.env.GITHUB_REPO || "repairs";
const LABEL = process.env.SUBMISSION_LABEL || "app-submission";
const INTERVAL = Number(process.env.MONITOR_INTERVAL_MS || 60000);

function octo() {
  const t = process.env.GITHUB_TOKEN;
  if (!t) throw new Error("Monitor is missing GITHUB_TOKEN");
  return new Octokit({ auth: t });
}

async function tick() {
  const kit = octo();
  const prs = await kit.pulls.list({ owner: OWNER, repo: REPO, state: "open", per_page: 50, sort: "created", direction: "desc" });
  for (const pr of prs.data) {
    const labels = pr.labels.map((l) => l.name);
    if (LABEL && !labels.includes(LABEL)) continue;       // only submission PRs
    if (labels.some((l) => l.startsWith("ai:"))) continue; // already moderated
    try {
      const r = await moderatePullRequest(kit, OWNER, REPO, pr.number);
      if (r) console.log(`moderated #${pr.number} -> ${r.decision}`);
    } catch (e) {
      console.error(`#${pr.number}: ${e.message}`);
    }
  }
}

(async () => {
  console.log(`monitor: ${OWNER}/${REPO}, label "${LABEL}", every ${INTERVAL}ms`);
  for (;;) {
    try { await tick(); } catch (e) { console.error("tick:", e.message); }
    await new Promise((r) => setTimeout(r, INTERVAL));
  }
})();
