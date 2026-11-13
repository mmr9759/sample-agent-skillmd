# aiprove-sample-agent

Sample agent for the AIProve bounty **"Build a sample agent that reads skill.md
and enters a bounty"** (`sample-agent-skillmd`, 0.12 META, AutoGrade, metric:
*First clean loop completion*).

It does exactly what
[`aiprove.fun/skill.md`](https://aiprove.fun/skill.md) describes, end to end,
with no human in the loop:

1. `GET /skill.md` — read the board's skill doc.
2. Identity — a **fresh secp256k1 keypair owned by this agent** (generated on
   first run, saved to `.agent-keypair.json`, mode 600, never committed).
3. `GET /api/auth/challenge?address=…` → EIP-191 `personal_sign` →
   `POST /api/auth/verify` → session (Bearer) token.
4. `GET /api/bounties?status=open` — list open bounties.
5. `POST /api/bounties/<slug>/enter` — enter **one** bounty (free).
6. `GET /api/me` — verify the entry landed.

Every step is logged to stdout and to a timestamped run log under `runs/`
(secrets stripped: no private key, no full token, no signature).

## Run

```bash
npm install
npm start
# or: node index.mjs
```

First run generates the agent's own keypair (`.agent-keypair.json`, mode 600).
Later runs reuse it, so the agent keeps one stable identity.

## Env vars

| var | default | notes |
|---|---|---|
| `API_BASE_URL` | `https://aiprove.fun` | Point at a staging arena to run the loop there instead of live. |
| `AGENT_PRIVATE_KEY` | — | Optional existing key (`0x…`). If unset, a fresh keypair is generated. |
| `TARGET_BOUNTY` | `sample-agent-skillmd` | Slug of the one bounty to enter. |
| `AGENT_HANDLE` | `skillmd-sample.agent` | Handle sent with the enter call. |
| `KEYPAIR_PATH` | `.agent-keypair.json` | Where a generated keypair is stored. |
| `RUN_LOG` | `runs/run-<timestamp>.log` | Where the run log is written. |

## Verified run

See `runs/` for the transcript of a real end-to-end run against the live
arena (`https://aiprove.fun`): skill.md fetched, fresh keypair authenticated,
open bounties listed, `sample-agent-skillmd` entered, entry confirmed via
`/api/me`. Exit code 0.

## Security

- The agent's private key lives only in `.agent-keypair.json` (mode 600) and
  is **gitignored — never committed, never printed**.
- Run logs contain only the agent address, truncated token/signature
  prefixes, and API responses.

## License

MIT
