# Security model

> Threat model plus the protection layers currently in place. Update this file whenever the security posture changes.
> 中文：[SECURITY.md](./SECURITY.md)

---

## Threat model

We seriously defend against:

1. Public endpoints being batch-attacked by scripts (mass-spam invitations / feedback)
2. OAuth tokens being read without authorization (defense in depth after DB or server compromise)
3. Unauthorized users gaining admin API data (lateral / vertical privilege escalation)
4. XSS / clickjacking / CSRF
5. Session hijacking / replay
6. Cloudflare Turnstile bypass via automated solvers

Out of scope:

- Nation-state APT
- Physical server takeover
- Internal admin abuse (we trust GitHub's admin role)

---

## Current protection layers

### 1. Public endpoint anti-abuse

Every public POST (`/api/feedback`, `/api/join/:token`) goes through `server/src/middleware/pow.ts`'s `preflightPublicSubmission()`:

#### 1.1 IP rate limit
- `/api/feedback`: 10/min
- `/api/join/:token`: 5/min
- Backed by `@fastify/rate-limit`

#### 1.2 Honeypot field
- Form contains `<input name="website">` hidden off-screen, `tabIndex={-1}`, `aria-hidden="true"`
- Real users never fill it; auto-fill bots do
- Server rejects non-empty value with 400

#### 1.3 Proof-of-Work
- Client computes SHA-256: `sha256("${timestamp}:${bodyHash}:${nonce}")` must start with N `0`s
- `POW_DIFFICULTY` default 3 (16^3 = 4096 expected hashes, second-scale on modest hardware)
- Server checks: clock drift ≤ ±5 min, valid nonce length, hash prefix really starts with N zeros
- Attackers batching requests pay CPU per item; raising the difficulty amplifies cost exponentially
- Tunable: 4 or 5 (each 10× harder) via `.env` `POW_DIFFICULTY`

#### 1.4 Cloudflare Turnstile (optional)
- Enable by setting `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`
- Layered on top of PoW; CF's adaptive analysis is harder to bypass than pure PoW
- Frictionless for real users (most pass with zero interaction)

#### 1.5 Content validation
- Length 5-5000 chars
- GitHub username regex `^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$`
- Email regex
- Note ≤ 280 chars

### 2. OAuth token protection

#### 2.1 Encryption at rest
- `server/src/lib/crypto.ts` uses AES-256-GCM (12-byte random IV, 16-byte auth tag)
- `ENCRYPTION_KEY` must base64 decode to 32 bytes
- Encrypts: `sessions.access_token`, `invite_links.created_by_token`
- DB leak alone won't expose tokens (attacker needs `.env`'s key too)

#### 2.2 Cookie hardening
- `httpOnly: true` — JS cannot read
- `secure: true` — HTTPS only
- `sameSite: "lax"` — anti-CSRF
- 7-day TTL with server-side record (not pure JWT) → can force-invalidate

#### 2.3 OAuth state check
- `/auth/github` issues random state + return_to into `oauth_state` cookie
- callback compares strictly to prevent injection

### 3. Authorization

#### 3.1 Two-layer preHandler
- `requireAuth` — session cookie must validate and token must decrypt
- `requireOrgRole("admin"|"member")` — calls `GET /orgs/{org}/memberships/{login}` LIVE with the user's own token
- Permissions are never cached. GitHub-side role is source of truth.

#### 3.2 User-token model
- All admin API calls use the **signed-in user's** OAuth token
- Even if our authz has bugs, GitHub's permissions reject unauthorized calls
- Only exception: public invite-link uses the admin's encrypted-at-rest token (single use: send invitation)

### 4. Browser-side defenses (nginx response headers)

#### 4.1 HSTS
`Strict-Transport-Security: max-age=63072000; includeSubDomains` — force HTTPS for 2 years

#### 4.2 CSP
```
default-src 'self';
script-src 'self' https://challenges.cloudflare.com;
style-src 'self' 'unsafe-inline';
img-src 'self' data: https://avatars.githubusercontent.com https://*.githubusercontent.com;
font-src 'self' data:;
connect-src 'self' https://challenges.cloudflare.com;
frame-src https://challenges.cloudflare.com;
frame-ancestors 'none';
base-uri 'self';
form-action 'self' https://github.com
```
Injected `<script>` won't execute; iframe embedding blocked.

#### 4.3 Misc
- `X-Frame-Options: DENY` — clickjacking
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=(), usb=()`
- `Cross-Origin-Opener-Policy: same-origin`

### 5. Server-side code

- No `eval` / `Function(...)` / `dangerouslySetInnerHTML` (except markdown viewer where input is server-controlled)
- All SQL via better-sqlite3 prepared statements (no concatenation)
- Octokit handles URL encoding
- `client_max_body_size 1m`

---

## Known un-defended

- GitHub itself being compromised: out of our control
- OAuth App secret leak: revoke + reissue immediately; secret only in `.env` (chmod 600)
- Server root compromise: relies on OS hardening + backups
- Turnstile 0-day: relies on CF

---

## Debug / disable knobs

| Goal | How |
|---|---|
| Disable PoW for local dev | `POW_DIFFICULTY=0` in `.env` |
| Raise PoW difficulty | `POW_DIFFICULTY=6` (10× cost) |
| Enable Turnstile | set `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` |
| Disable Turnstile | unset those two |
| Inspect public submission failures | check `audit_logs.details` JSON |
| Check honeypot rejection | server log shows "请求被拒绝" |

---

## Hardened invariants

- OAuth tokens MUST be AES-256-GCM encrypted at rest (never plaintext)
- Public POST MUST go through PoW + honeypot
- Admin API MUST have both preHandlers (requireAuth + requireOrgRole)
- `audit_logs` MUST NOT leak into any public response
- Session cookie MUST be httpOnly + secure + sameSite=lax
- Changing OAuth scope or encryption key counts as a major event

---

## Reporting vulnerabilities

Privately contact the `Yangtze-University-Geek-Class` org owner (GitHub login: Crosery).
