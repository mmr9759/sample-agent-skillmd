#!/usr/bin/env node
/**
 * aiprove-sample-agent — sample agent for the AIProve bounty
 * "Build a sample agent that reads skill.md and enters a bounty".
 *
 * The loop, exactly as https://aiprove.fun/skill.md describes it:
 *   1. GET /skill.md            — read the board's skill doc
 *   2. identity                 — fresh secp256k1 keypair, owned by THIS agent
 *   3. GET  /api/auth/challenge?address=...  → personal_sign → POST /api/auth/verify
 *   4. GET  /api/bounties?status=open
 *   5. POST /api/bounties/<slug>/enter   (free, one bounty)
 *   6. GET  /api/me             — verify the entry landed
 *
 * Every step is logged to stdout and to a timestamped run log under runs/
 * (secrets stripped: no private key, no full session token, no signature).
 *
 * Env vars:
 *   API_BASE_URL   base URL of the arena (default https://aiprove.fun;
 *                  point it at a staging arena to run the loop there)
 *   AGENT_PRIVATE_KEY  optional existing key (0x...). If unset, a FRESH
 *                  keypair is generated and saved to .agent-keypair.json
 *                  (mode 600, gitignored — never committed).
 *   TARGET_BOUNTY  slug to enter (default: sample-agent-skillmd)
 *   AGENT_HANDLE   handle sent with the enter call (default: skillmd-sample.agent)
 *   KEYPAIR_PATH   where to store a generated keypair (default: .agent-keypair.json)
 *   RUN_LOG        where to write the run log (default: runs/run-<timestamp>.log)
 */

import { Wallet } from "ethers";
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API = (process.env.API_BASE_URL || "https://aiprove.fun").replace(/\/$/, "");
const TARGET = process.env.TARGET_BOUNTY || "sample-agent-skillmd";
const HANDLE = process.env.AGENT_HANDLE || "skillmd-sample.agent";
const KEYPAIR_PATH = process.env.KEYPAIR_PATH || path.join(__dirname, ".agent-keypair.json");
const RUN_LOG =
  process.env.RUN_LOG ||
  path.join(__dirname, "runs", `run-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);

const startedAt = new Date().toISOString();
const lines = [];
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  lines.push(line);
  console.log(line);
}
function redactToken(t) {
  return t ? `${t.slice(0, 8)}…${t.slice(-4)} (len ${t.length})` : "(none)";
}

async function api(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, ok: res.ok, json, text };
}

async function main() {
  log(`aiprove-sample-agent starting (API_BASE_URL=${API}, target=${TARGET})`);

  // --- Step 1: read skill.md, the way the bounty asks -------------------
  const skillRes = await fetch(`${API}/skill.md`);
  const skill = await skillRes.text();
  if (!skillRes.ok || !skill.includes("api/auth/challenge")) {
    throw new Error(`GET /skill.md failed: HTTP ${skillRes.status}`);
  }
  log(`[1/6] GET /skill.md -> HTTP ${skillRes.status}, ${skill.length} chars, ` +
      `mentions /api/auth/challenge: yes, /api/bounties: yes, /enter: yes`);

  // --- Step 2: identity — own keypair ------------------------------------
  let wallet;
  if (process.env.AGENT_PRIVATE_KEY) {
    wallet = new Wallet(process.env.AGENT_PRIVATE_KEY.trim());
    log(`[2/6] identity: using AGENT_PRIVATE_KEY, address ${wallet.address}`);
  } else if (existsSync(KEYPAIR_PATH)) {
    const { privateKey } = JSON.parse(await readFile(KEYPAIR_PATH, "utf8"));
    wallet = new Wallet(privateKey);
    log(`[2/6] identity: loaded existing keypair from ${path.basename(KEYPAIR_PATH)}, address ${wallet.address}`);
  } else {
    wallet = Wallet.createRandom();
    await writeFile(KEYPAIR_PATH, JSON.stringify({ address: wallet.address, privateKey: wallet.privateKey }, null, 2), { mode: 0o600 });
    await chmod(KEYPAIR_PATH, 0o600);
    log(`[2/6] identity: generated FRESH keypair, address ${wallet.address}, saved to ${path.basename(KEYPAIR_PATH)} (mode 600, gitignored)`);
  }

  // --- Step 3: challenge -> personal_sign -> session token ---------------
  const ch = await api(`/api/auth/challenge?address=${wallet.address}`);
  if (!ch.ok || !ch.json?.challenge) {
    throw new Error(`GET /api/auth/challenge failed: HTTP ${ch.status} ${ch.text.slice(0, 200)}`);
  }
  log(`[3/6] GET /api/auth/challenge -> HTTP ${ch.status}, challenge received (${ch.json.challenge.length} chars)`);
  const signature = await wallet.signMessage(ch.json.challenge);
  log(`[3/6] personal_sign(challenge) -> signature ${signature.slice(0, 14)}… (len ${signature.length})`);
  const ver = await api("/api/auth/verify", {
    method: "POST",
    body: { address: wallet.address, signature },
  });
  if (!ver.ok || !ver.json?.token) {
    throw new Error(`POST /api/auth/verify failed: HTTP ${ver.status} ${ver.text.slice(0, 200)}`);
  }
  const token = ver.json.token;
  log(`[3/6] POST /api/auth/verify -> HTTP ${ver.status}, session token ${redactToken(token)}, expiresAt ${ver.json.expiresAt ?? "n/a"}`);

  // --- Step 4: list open bounties ----------------------------------------
  const list = await api("/api/bounties?status=open");
  if (!list.ok || !Array.isArray(list.json?.bounties)) {
    throw new Error(`GET /api/bounties failed: HTTP ${list.status} ${list.text.slice(0, 200)}`);
  }
  const open = list.json.bounties;
  log(`[4/6] GET /api/bounties?status=open -> HTTP ${list.status}, ${open.length} open bounties`);
  for (const b of open) {
    log(`       - ${b.slug} | ${b.title} | ${b.amt} ${b.unit} | ${b.lane} | closes ${b.closes}`);
  }
  const target = open.find((b) => b.slug === TARGET);
  if (!target) {
    throw new Error(`target bounty "${TARGET}" is not open (not in the ${open.length} open bounties)`);
  }
  log(`[4/6] target "${TARGET}" found and open: "${target.title}", ${target.amt} ${target.unit}, lane ${target.lane}`);

  // --- Step 5: enter one bounty (free) ------------------------------------
  const enter = await api(`/api/bounties/${TARGET}/enter`, {
    method: "POST",
    token,
    body: { handle: HANDLE },
  });
  if (!enter.ok) {
    throw new Error(`POST /api/bounties/${TARGET}/enter failed: HTTP ${enter.status} ${enter.text.slice(0, 300)}`);
  }
  log(`[5/6] POST /api/bounties/${TARGET}/enter (handle=${HANDLE}) -> HTTP ${enter.status}: ${JSON.stringify(enter.json ?? enter.text).slice(0, 400)}`);

  // --- Step 6: verify via /api/me -----------------------------------------
  const me = await api("/api/me", { token });
  if (!me.ok) {
    throw new Error(`GET /api/me failed: HTTP ${me.status} ${me.text.slice(0, 200)}`);
  }
  const competing = me.json?.competing ?? me.json?.entries ?? me.json;
  log(`[6/6] GET /api/me -> HTTP ${me.status}: ${JSON.stringify(me.json).slice(0, 600)}`);
  const entered = JSON.stringify(me.json).includes(TARGET);
  log(entered
    ? `VERIFY OK: /api/me confirms this agent is competing in "${TARGET}".`
    : `VERIFY WARNING: /api/me response does not mention "${TARGET}" — check the enter response above.`);

  log(`DONE: clean loop completed in ${((Date.now() - Date.parse(startedAt)) / 1000).toFixed(1)}s. ` +
      `agent=${wallet.address} handle=${HANDLE} entered=${TARGET}`);
  return entered;
}

try {
  const ok = await main();
  await mkdir(path.dirname(RUN_LOG), { recursive: true });
  await writeFile(RUN_LOG, lines.join("\n") + "\n");
  console.log(`run log saved to ${RUN_LOG}`);
  process.exit(ok ? 0 : 2);
} catch (err) {
  log(`ERROR: ${err.message}`);
  try {
    await mkdir(path.dirname(RUN_LOG), { recursive: true });
    await writeFile(RUN_LOG, lines.join("\n") + "\n");
    console.log(`run log saved to ${RUN_LOG}`);
  } catch { /* ignore */ }
  console.error(err);
  process.exit(1);
}
