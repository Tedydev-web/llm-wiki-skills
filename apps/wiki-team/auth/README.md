# apps/wiki-team/auth — Auth + Identity Layer

Phase 04 implementation. Two auth channels:

1. **Session (HTTP/browser)** — OAuth via Better Auth → session cookie → `source: 'session'`
2. **MCP Bearer (programmatic)** — `wkt_<32 base62>` token → argon2id verify → `source: 'mcp-token'`

---

## Required Environment Variables

The coordinator will merge these into `apps/wiki-team/.env.example` after Wave 1.

| Variable | Description | Example |
|---|---|---|
| `BETTER_AUTH_SECRET` | HMAC key for prefix_lookup + Better Auth session signing. Min 32 chars. | `openssl rand -hex 32` |
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 client ID | `123456789.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 client secret | `GOCSPX-...` |
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID | `Ov23li...` |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret | `abc123...` |

**Total: 5 env vars**

---

## Token Format

```
wkt_<32 base62 chars>
```

- `wkt_` — fixed 4-char class prefix (wiki-team token identifier)
- 32-char suffix — `[0-9A-Za-z]` random, ≈190 bits entropy
- Total length: 36 chars

**Never log the full token.** Log `wkt_` prefix only for tracing.

---

## DB Storage (mcp_tokens table — P03 owns schema)

| Column | Value | Notes |
|---|---|---|
| `prefix_lookup` | `HMAC-SHA256(plaintext, BETTER_AUTH_SECRET)[0..16 hex]` | Indexed for O(1) lookup; no plaintext bits on disk |
| `token_hash` | `argon2id(plaintext, { mem: 64MB, time: 3, par: 4 })` | At-rest protection |
| `revoked_at` | Soft-delete timestamp | Never hard-delete — audit trail |

---

## argon2id Parameters

```ts
{ memoryCost: 65536, timeCost: 3, parallelism: 4 }
```

~100 ms verify latency on miss path (constant-time dummy hash always runs).
Mitigate with in-memory LRU cache (TTL 60 s) in P07 if needed.

---

## Constant-Time Verify

On **every** verify path (no row, revoked, expired, or hash-mismatch),
`argon2id.verify(DUMMY_HASH, presented)` runs unconditionally. This prevents
timing-oracle attacks that could reveal whether a prefix_lookup exists in the DB.

---

## Rate Limits

- Max **10 MCP tokens** issued per user per calendar day (UTC)
- Redis key: `token-issue-rate:<userId>:<YYYY-MM-DD>`
- Exceeding limit → `HTTP 429`

---

## Step-Up Reauth

Issuing a new MCP token requires a **fresh session** (created ≤ 15 minutes ago).
Stale session → `HTTP 401` with message prompting re-authentication.

---

## Module Map

| File | Responsibility |
|---|---|
| `token-id.ts` | `generateMcpTokenId()` + `computePrefixLookup()` |
| `oauth-providers.ts` | Google + GitHub provider config builders + `assertOAuthEnv()` |
| `better-auth.ts` | `createAuthInstance(db)` factory + `assertAuthEnv()` |
| `mcp-token-service.ts` | `issueMcpToken`, `verifyMcpToken`, `revokeMcpToken`, `rotateMcpToken`, `revokeAllMcpTokens` |
| `auth-context.ts` | `AuthContext` type + `authContextMiddleware()` Hono middleware + `requireAuth()` guard |

---

## Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Create OAuth 2.0 Client ID (Web application)
3. Add authorised redirect URI: `http://localhost:3000/api/auth/callback/google`
4. Copy Client ID + Secret to env vars

## GitHub OAuth Setup

1. Go to GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
2. Set callback URL: `http://localhost:3000/api/auth/callback/github`
3. Copy Client ID + Secret to env vars
