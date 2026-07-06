// Print the ban audit log for maintainer review, with receipts.
//   npm run bans                              (local, reads $BANS_STORE or ./data/bans.json)
//   docker compose exec submit npm run bans   (inside the running container's volume)
import { listBans } from "../src/store.js";

const bans = listBans();
if (!bans.length) { console.log("No bans recorded."); process.exit(0); }

console.log(`${bans.length} ban(s) (newest last):\n`);
for (const b of bans) {
  console.log(`- ${b.ts}  ${b.email}`);
  console.log(`    reason:  ${b.reason}`);
  if (b.prNumber) console.log(`    PR:      #${b.prNumber} ${b.prUrl}`);
  if (b.prTitle)  console.log(`    title:   ${b.prTitle}`);
  if (b.verdict)  console.log(`    verdict: ${b.verdict.decision}/${b.verdict.severity || "n/a"} - ${b.verdict.summary || ""}`);
  if (b.evidence) console.log(`    evidence: ${b.evidence}`);
  console.log("");
}
