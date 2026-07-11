// Unit tests for Claude moderation side effects without shelling out to Claude.
//   node tests/moderate.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "repairs-moderate-"));
process.env.TRUST_STORE = join(dir, "trust.json");
process.env.BANS_STORE = join(dir, "bans.json");
process.env.MODERATION_LOG_STORE = join(dir, "moderation.jsonl");
process.env.TRUST_BLOCK_AT = "-4";

const { moderatePullRequest } = await import("../server/src/moderate.js");
const { readModerationLog } = await import("../server/src/store.js");

let pass = 0;
const t = async (name, fn) => { await fn(); console.log("  ✓ " + name); pass++; };

function fakeKit({ merge } = {}) {
  const calls = { comments: [], labels: [], merges: [], updates: [] };
  const kit = {
    pulls: {
      get: async ({ owner, repo, pull_number }) => ({
        data: {
          state: "open",
          title: "New guide: safe roadside repair",
          body: "Submitted from the app by **Driver** (driver@example.com).",
          html_url: `https://github.com/${owner}/${repo}/pull/${pull_number}`,
        },
      }),
      listFiles: async () => ({ data: [{ filename: "marketplace.json", patch: "+ safe guide" }] }),
      merge: async (args) => {
        calls.merges.push(args);
        if (merge === "throw") throw new Error("Merge conflict");
        if (merge === false) return { data: { merged: false, message: "Not mergeable" } };
        return { data: { merged: true, message: "Pull Request successfully merged" } };
      },
      update: async (args) => { calls.updates.push(args); return { data: {} }; },
    },
    issues: {
      listComments: async () => ({ data: [] }),
      createComment: async (args) => { calls.comments.push(args); return { data: {} }; },
      getLabel: async () => ({ data: {} }),
      createLabel: async () => ({ data: {} }),
      addLabels: async (args) => { calls.labels.push(args); return { data: {} }; },
    },
  };
  return { kit, calls };
}

const approvedVerdict = {
  decision: "approve",
  promptInjection: false,
  severity: "none",
  categories: [],
  summary: "The guide is safe, on-topic, and complete.",
};

console.log("moderate.js — approve side effects");
await t("approved PRs are merged and not explicitly closed", async () => {
  const { kit, calls } = fakeKit();
  const result = await moderatePullRequest(kit, "sharpninja", "repairs-data", 7, {
    submitter: "driver@example.com",
    moderationVerdict: approvedVerdict,
  });

  assert.equal(result.decision, "approve");
  assert.equal(result.autoMerge.status, "merged");
  assert.equal(calls.merges.length, 1);
  assert.deepEqual(calls.merges[0], { owner: "sharpninja", repo: "repairs-data", pull_number: 7 });
  assert.equal(calls.updates.length, 0);
  assert.ok(calls.labels.some((x) => x.labels.includes("ai:approve")));

  const last = readModerationLog(10).at(-1);
  assert.equal(last.prNumber, 7);
  assert.equal(last.decision, "approve");
  assert.equal(last.autoMerge, "merged");
});

await t("failed auto-merge leaves the PR open and logs the failure", async () => {
  const { kit, calls } = fakeKit({ merge: "throw" });
  const result = await moderatePullRequest(kit, "sharpninja", "repairs-data", 8, {
    submitter: "driver@example.com",
    moderationVerdict: approvedVerdict,
  });

  assert.equal(result.decision, "approve");
  assert.equal(result.autoMerge.status, "failed");
  assert.match(result.autoMerge.error, /Merge conflict/);
  assert.equal(calls.merges.length, 1);
  assert.equal(calls.updates.length, 0);
  assert.ok(calls.comments.some((x) => x.body.includes("Auto-merge failed")));

  const last = readModerationLog(10).at(-1);
  assert.equal(last.prNumber, 8);
  assert.equal(last.autoMerge, "failed");
  assert.match(last.autoMergeError, /Merge conflict/);
});

await t("unmerged GitHub responses leave the PR open and log the message", async () => {
  const { kit, calls } = fakeKit({ merge: false });
  const result = await moderatePullRequest(kit, "sharpninja", "repairs-data", 9, {
    submitter: "driver@example.com",
    moderationVerdict: approvedVerdict,
  });

  assert.equal(result.decision, "approve");
  assert.equal(result.autoMerge.status, "failed");
  assert.match(result.autoMerge.error, /Not mergeable/);
  assert.equal(calls.merges.length, 1);
  assert.equal(calls.updates.length, 0);
  assert.ok(calls.comments.some((x) => x.body.includes("Not mergeable")));

  const last = readModerationLog(10).at(-1);
  assert.equal(last.prNumber, 9);
  assert.equal(last.autoMerge, "failed");
  assert.match(last.autoMergeError, /Not mergeable/);
});

console.log(`\n${pass} assertions passed.`);
