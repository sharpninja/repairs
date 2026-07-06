// File-backed session store. A session key is minted from a verified Google
// identity (StartSession) and rotated on app startup (RefreshSession). Every
// submission is tagged with the current session key, which resolves to the user.
// Persisted to a mounted volume (SESSION_STORE) so sessions survive restarts.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

const FILE = process.env.SESSION_STORE || "./data/sessions.json";
const TTL = Number(process.env.SESSION_TTL_MS || 24 * 3600 * 1000); // 24h

function load() { try { return JSON.parse(readFileSync(FILE, "utf8")); } catch (e) { return {}; } }
function save(db) {
  try { mkdirSync(dirname(FILE), { recursive: true }); writeFileSync(FILE, JSON.stringify(db)); }
  catch (e) { console.error("session save:", e.message); }
}
function gc(db) { const now = Date.now(); for (const k of Object.keys(db)) if (!db[k] || db[k].exp < now) delete db[k]; }
const newKey = () => randomBytes(24).toString("hex");

export function createSession(email, name) {
  const db = load(); gc(db);
  const key = newKey();
  db[key] = { email, name: name || "", exp: Date.now() + TTL };
  save(db);
  return { key, email, exp: db[key].exp };
}

// Rotate: invalidate the old key, issue a new one. Returns null if the old key
// is missing/expired (the app then requires a fresh Google login).
export function rotateSession(oldKey) {
  const db = load(); gc(db);
  const s = oldKey && db[oldKey];
  if (!s) return null;
  delete db[oldKey];
  const key = newKey();
  db[key] = { email: s.email, name: s.name, exp: Date.now() + TTL };
  save(db);
  return { key, email: s.email, exp: db[key].exp };
}

export function resolveSession(key) {
  if (!key) return null;
  const db = load();
  const s = db[key];
  if (!s || s.exp < Date.now()) return null;
  return { email: s.email, name: s.name };
}
