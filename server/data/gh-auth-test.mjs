import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
const appId = process.env.GITHUB_APP_ID;
const key = (process.env.GITHUB_APP_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const inst = process.env.GITHUB_APP_INSTALLATION_ID;
const token = process.env.GITHUB_TOKEN;
try {
  let kit;
  if (appId && key && inst) {
    kit = new Octokit({ authStrategy: createAppAuth, auth: { appId, privateKey: key, installationId: Number(inst) } });
  } else if (token) {
    kit = new Octokit({ auth: token });
  } else { console.log(JSON.stringify({ ok:false, err:'no creds' })); process.exit(2); }
  const owner = process.env.GITHUB_OWNER || 'sharpninja';
  const repo = process.env.GITHUB_REPO || 'repairs-data';
  const r = await kit.repos.get({ owner, repo });
  const base = process.env.GITHUB_BASE || 'approved';
  let refOk = false, refErr = '';
  try { await kit.git.getRef({ owner, repo, ref: `heads/${base}` }); refOk = true; } catch (e) { refErr = e.message; }
  console.log(JSON.stringify({ ok:true, repo:r.data.full_name, base, refOk, refErr, auth: appId && key && inst ? 'app' : 'token' }));
} catch (e) {
  console.log(JSON.stringify({ ok:false, err:e.message, status:e.status }));
  process.exit(1);
}