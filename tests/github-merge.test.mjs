// Unit tests for GitHub catalog merge-conflict helpers (pure Node, no network).
//   node tests/github-merge.test.mjs
import assert from "node:assert/strict";
import { mergeCatalogDelta, resolveGeneratedCatalogConflict } from "../server/src/github.js";

let pass = 0;
const t = (name, fn) => { fn(); console.log("  ✓ " + name); pass++; };

console.log("github.js — catalog conflict merging");
t("appends new guide entries from a stale PR branch", () => {
  const base = { guides: [{ id: "base", guide: { title: "Base" }, reviews: [] }] };
  const proposed = { guides: [base.guides[0], { id: "new", guide: { title: "New" }, reviews: [] }] };
  const result = mergeCatalogDelta(base, proposed);

  assert.equal(result.changed, 1);
  assert.deepEqual(result.catalog.guides.map((guide) => guide.id), ["base", "new"]);
  assert.equal(base.guides.length, 1);
});

t("does not duplicate guide entries that already landed", () => {
  const base = { guides: [{ id: "same", guide: { title: "Same" }, reviews: [] }] };
  const proposed = { guides: [{ id: "same", guide: { title: "Same" }, reviews: [] }] };
  const result = mergeCatalogDelta(base, proposed);

  assert.equal(result.changed, 0);
  assert.equal(result.catalog.guides.length, 1);
});

t("merges missing reviews and refreshes rating", () => {
  const existingReview = { author: "a@example.com", stars: 4, text: "good", ts: 1, source: "app" };
  const newReview = { author: "b@example.com", stars: 5, text: "great", ts: 2, source: "app" };
  const base = { guides: [{ id: "guide", guide: { title: "Guide" }, rating: { avg: 4, count: 1 }, reviews: [existingReview] }] };
  const proposed = { guides: [{ id: "guide", guide: { title: "Guide" }, reviews: [existingReview, newReview] }] };
  const result = mergeCatalogDelta(base, proposed);

  assert.equal(result.changed, 1);
  assert.equal(result.catalog.guides[0].reviews.length, 2);
  assert.deepEqual(result.catalog.guides[0].rating, { avg: 4.5, count: 2 });
});

await (async () => {
  const baseCatalog = { guides: [{ id: "base", guide: { title: "Base" }, reviews: [] }] };
  const headCatalog = { guides: [...baseCatalog.guides, { id: "new", guide: { title: "New" }, reviews: [] }] };
  const calls = { updates: [], puts: [], merges: 0 };
  const kit = {
    pulls: {
      get: async () => ({ data: { head: { ref: "submit/pr", repo: { full_name: "sharpninja/repairs-data" } }, base: { ref: "approved" } } }),
      merge: async () => { calls.merges++; return { data: { merged: true } }; },
    },
    repos: {
      getContent: async ({ ref }) => ({
        data: {
          sha: ref === "approved" ? "base-file-sha" : "head-file-sha",
          content: Buffer.from(JSON.stringify(ref === "approved" ? baseCatalog : headCatalog), "utf8").toString("base64"),
        },
      }),
      createOrUpdateFileContents: async (args) => { calls.puts.push(args); return { data: {} }; },
    },
    git: {
      getRef: async () => ({ data: { object: { sha: "base-commit-sha" } } }),
      updateRef: async (args) => { calls.updates.push(args); return { data: {} }; },
    },
    issues: { createComment: async () => ({ data: {} }) },
  };

  const result = await resolveGeneratedCatalogConflict(kit, "sharpninja", "repairs-data", { number: 9 }, "Pull Request has merge conflicts");
  t("resets conflicted PR branch onto base before rewriting catalog", () => {
    assert.equal(result.status, "merged");
    assert.deepEqual(calls.updates[0], { owner: "sharpninja", repo: "repairs-data", ref: "heads/submit/pr", sha: "base-commit-sha", force: true });
    assert.equal(calls.puts[0].sha, "base-file-sha");
    assert.equal(calls.merges, 1);
    const catalog = JSON.parse(Buffer.from(calls.puts[0].content, "base64").toString("utf8"));
    assert.deepEqual(catalog.guides.map((guide) => guide.id), ["base", "new"]);
  });
})();

console.log(`\n${pass} assertions passed.`);