// Mint a GitHub App installation token scoped to ONLY the operations the
// moderation + submit service needs, on ONLY the target repo. This is how you
// generate a least-privilege GITHUB_TOKEN (GitHub can't create fine-grained PATs
// via API — a GitHub App installation token is the scriptable, scoped equivalent).
//
// Env in: GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY_FILE (or GITHUB_APP_PRIVATE_KEY
// inline with \n), GITHUB_OWNER, GITHUB_REPO.
// Prints JSON: { token, installationId, expiresAt, permissions }.
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { readFileSync } from "node:fs";

const appId = process.env.GITHUB_APP_ID;
const owner = process.env.GITHUB_OWNER || "sharpninja";
const repo = process.env.GITHUB_REPO || "repairs-data";
const keyFile = process.env.GITHUB_APP_PRIVATE_KEY_FILE;
const keyInline = process.env.GITHUB_APP_PRIVATE_KEY;

if (!appId || (!keyFile && !keyInline)) {
  console.error("Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY_FILE (or GITHUB_APP_PRIVATE_KEY).");
  process.exit(1);
}
const privateKey = keyFile ? readFileSync(keyFile, "utf8") : keyInline.replace(/\\n/g, "\n");

// The exact least-privilege set:
//   contents:write       - commit the marketplace.json change (submit)
//   pull_requests:write  - open PRs, comment, close on reject (submit + moderation)
//   issues:write         - labels + moderation comments (moderation)
//   metadata:read        - required baseline
const permissions = { contents: "write", pull_requests: "write", issues: "write", metadata: "read" };

try {
  const appOcto = new Octokit({ authStrategy: createAppAuth, auth: { appId, privateKey } });
  const inst = await appOcto.rest.apps.getRepoInstallation({ owner, repo });
  const installationId = inst.data.id;

  const auth = createAppAuth({ appId, privateKey });
  const { token, expiresAt } = await auth({
    type: "installation",
    installationId,
    repositoryNames: [repo],   // scope the token to this one repo
    permissions,               // scope to just these operations
  });

  process.stdout.write(JSON.stringify({ token, installationId, expiresAt, permissions }) + "\n");
} catch (e) {
  console.error("Failed to mint token:", e.message);
  console.error("Check the App ID, private key, and that the App is installed on " + owner + "/" + repo + ".");
  process.exit(1);
}
