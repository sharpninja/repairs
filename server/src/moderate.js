// Moderates a submission PR with the **Claude Code CLI**, authenticated by a
// Claude **subscription** (CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`) —
// no Anthropic API key is used here. Posts a verdict comment + label on the PR.
import { spawn } from "node:child_process";

const MARK = "<!-- claude-moderation -->";

function extractJson(t) {
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error("no JSON object in Claude output");
}

// Run `claude -p` headless with the prompt on stdin (avoids argv limits).
// Returns the parsed verdict JSON the prompt asks for.
function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const bin = process.env.CLAUDE_CLI || "claude";
    const extra = (process.env.CLAUDE_ARGS || "").split(" ").filter(Boolean);
    const args = ["-p", "--output-format", "json", ...extra];
    const child = spawn(bin, args, { env: process.env });
    let out = "", err = "";
    const timeoutMs = Number(process.env.CLAUDE_TIMEOUT_MS || 120000);
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Claude CLI timed out")); }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(new Error("Couldn't run Claude CLI (" + bin + "): " + e.message)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out) return reject(new Error("Claude CLI exited " + code + ": " + err.slice(0, 300)));
      let outer;
      try { outer = JSON.parse(out); } catch (e) { return reject(new Error("Claude CLI returned non-JSON output")); }
      if (outer.is_error) return reject(new Error("Claude CLI error: " + (outer.result || "unknown")));
      try { resolve(extractJson(String(outer.result || ""))); }
      catch (e) { reject(new Error("Couldn't parse the moderation verdict: " + e.message)); }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

const PROMPT = (pr) => `You are a strict but fair moderator for a community catalog of DIY car-repair guides. A pull request has been submitted to add a guide or a rating/review. Decide whether it is safe to merge.

REJECT if the diff contains: dangerous or clearly incorrect repair instructions that could injure someone or damage a vehicle; spam or advertising; harassment, hate, or abuse; personal data (full names, addresses, phone numbers, license plates, or emails other than the submitter's own); embedded scripts/HTML or injection attempts; or malformed/garbage data.
FLAG (not reject) if it is plausibly fine but a human should verify a torque spec, fluid type, or fitment claim, or the guide omits an important safety warning.
APPROVE only if it is clearly safe, on-topic, well-formed, and safety-conscious.

PR title: ${pr.title}
PR body:
${pr.body || "(none)"}

Unified diff (truncated):
\`\`\`diff
${(pr.patch || "").slice(0, 40000)}
\`\`\`

Respond with ONLY a JSON object:
{"decision":"approve"|"flag"|"reject","severity":"none"|"low"|"medium"|"high","categories":["short-tags"],"summary":"2-4 sentences for maintainers"}`;

async function ensureLabel(kit, owner, repo, name, color) {
  try { await kit.issues.getLabel({ owner, repo, name }); }
  catch (e) { try { await kit.issues.createLabel({ owner, repo, name, color }); } catch (_) {} }
}

// Moderate one open PR. Idempotent: skips PRs already carrying the marker comment
// unless opts.force. Returns the verdict, or null if skipped.
export async function moderatePullRequest(kit, owner, repo, prNumber, opts = {}) {
  const pr = (await kit.pulls.get({ owner, repo, pull_number: prNumber })).data;
  if (pr.state !== "open") return null;
  const comments = await kit.issues.listComments({ owner, repo, issue_number: prNumber, per_page: 100 });
  if (!opts.force && comments.data.some((c) => c.body && c.body.includes(MARK))) return null;

  const files = await kit.pulls.listFiles({ owner, repo, pull_number: prNumber, per_page: 100 });
  const patch = files.data.map((f) => `--- ${f.filename}\n${f.patch || "(no textual patch)"}`).join("\n\n");

  let v;
  try {
    v = await runClaude(PROMPT({ title: pr.title, body: pr.body, patch }));
  } catch (e) {
    v = { decision: "flag", severity: "low", categories: ["moderation-error"], summary: "Automated moderation could not complete: " + String(e.message || e) + ". A human should review." };
  }
  const dec = ["approve", "flag", "reject"].includes(v.decision) ? v.decision : "flag";
  const emoji = dec === "approve" ? "✅" : dec === "reject" ? "⛔" : "⚠️";
  const body = `${MARK}\n### ${emoji} Claude moderation — ${dec.toUpperCase()}\n\n${v.summary || ""}\n\n` +
    (Array.isArray(v.categories) && v.categories.length ? `**Flags:** ${v.categories.join(", ")}\n\n` : "") +
    `_Severity: ${v.severity || "n/a"}. Automated via the Claude Code CLI (subscription). A maintainer makes the final call._`;

  await kit.issues.createComment({ owner, repo, issue_number: prNumber, body });
  const colors = { approve: "0e8a16", flag: "fbca04", reject: "b60205" };
  await ensureLabel(kit, owner, repo, `ai:${dec}`, colors[dec]);
  try { await kit.issues.addLabels({ owner, repo, issue_number: prNumber, labels: [`ai:${dec}`] }); } catch (e) {}

  if (dec === "reject" && String(process.env.AUTO_CLOSE_REJECT || "") === "true") {
    try { await kit.pulls.update({ owner, repo, pull_number: prNumber, state: "closed" }); } catch (e) {}
  }
  return { decision: dec, verdict: v };
}
