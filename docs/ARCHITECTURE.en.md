# Architecture

## Topology

```
Internet
  │ 443 HTTPS
nginx ─── certbot (Let's Encrypt auto-renew)
  │ proxy_pass localhost:3000
Node + Fastify (single process, systemd-managed)
  ├── routes/auth.ts          OAuth flow + session
  ├── routes/orgs.ts          /api/me/orgs
  ├── routes/join.ts          /api/join/:token   public invite acceptance
  ├── routes/feedback.ts      /api/feedback      public submit
  ├── routes/docs.ts          /api/docs          serve markdown for in-app viewer
  └── routes/admin/*          per-org: /api/admin/:org/...
        ├── overview.ts members.ts repos.ts invitations.ts
        ├── invite-links.ts teams.ts activity.ts security.ts
        ├── org.ts feedback.ts logs.ts
SQLite (WAL)
  ├── sessions
  ├── invite_links
  ├── invitations
  ├── feedback
  ├── audit_logs
  └── app_state
```

## Authn / Authz

### Sign-in flow

1. User hits `/admin/signin` → clicks "Sign in with GitHub"
2. `/auth/github?return_to=...` issues a CSRF `state`, writes `oauth_state` cookie, redirects to `https://github.com/login/oauth/authorize`
3. User authorizes → callback hits `/auth/callback?code=...&state=...`
4. Server validates state, exchanges code for `access_token`, fetches `/user` for login + avatar
5. Creates a session record (access_token encrypted with AES-256-GCM)
6. Sets `sid` cookie (httpOnly, secure, sameSite=lax)
7. Redirects to `return_to`

OAuth scope: `read:user user:email admin:org read:org repo`

### Permission check

Every admin API route has two preHandlers:

1. `requireAuth` — validate session cookie, mount `req.session = { login, accessToken, ... }`
2. `requireOrgRole("admin" | "member")` — call `GET /orgs/{org}/memberships/{login}` using the user's own token; if insufficient → 403

**Critical**: every GitHub API call uses the **signed-in user's** access_token, NOT a global service token. GitHub-side ACL is the source of truth.

The only exception is public invite links: when generated, the admin's token is AES-encrypted into `invite_links.created_by_token_encrypted` so that anonymous visitors hitting `/join/:token` can invite on the admin's behalf.

## DB schema

```sql
sessions(id PK, login, user_id, avatar_url,
         access_token_encrypted, created_at, expires_at)
-- 7-day TTL

invite_links(token PK, org, created_by, created_by_token_encrypted,
             note, max_uses, current_uses, expires_at, team_slug, disabled, created_at)

invitations(id, org, invite_link_token, github_login, email,
            note, source_ip, user_agent, github_invitation_id, status, error_message, created_at)
-- status: sent / failed / pending_admin

feedback(id, org, content, category, contact, submitter_login, submitter_id,
         source_ip, user_agent, status, reply, replied_by, replied_at, votes, created_at, updated_at)
-- status: open / triaged / in_progress / done / wont_do / spam

audit_logs(id, org, actor, action, target, details JSON, ip, created_at)
-- actor may be a GitHub login or 'public:<token>' for unauthenticated events
```

## Encryption

- `ENCRYPTION_KEY` 32 bytes base64
- AES-256-GCM with 12-byte random IV, 16-byte auth tag
- Encoding: base64(iv || tag || ciphertext)
- Encrypted: session.access_token, invite_link.created_by_token

## Anti-abuse

- IP rate limit per public endpoint (`@fastify/rate-limit`)
- Honeypot field (invisible to humans, auto-filled by bots → 400)
- Client-side PoW: client computes SHA-256 nonce until hash starts with N zeros; server verifies. `POW_DIFFICULTY` env (default 5 ≈ ~1M hashes ≈ 1-2s CPU).
- Cloudflare Turnstile (optional via `TURNSTILE_*` env)

See [SECURITY.en.md](./SECURITY.en.md).

## Frontend

- Vite 6 + React 18 + React Router 7 + TanStack Query 5
- Tailwind colors are driven by CSS variables; the product exposes one light `yzgc-blue` theme and automatically falls back from legacy dark theme IDs
- Global providers: `<ConfirmProvider>` (themed modal replaces `window.confirm`), `<Select>` (themed dropdown replaces native `<select>`)
- Floating Action Button: feedback submission available on every page (auto-hidden on `/feedback` and `/join`)
- Markdown viewer for in-app docs (`/docs`) using `marked` + custom `.prose-doc` styles tied to theme vars

## Routes

| Path | Public? | Role |
|---|---|---|
| `/` | yes | landing |
| `/feedback`, `/feedback/:org` | yes | feedback submit |
| `/join/:token` | yes | invite accept |
| `/docs`, `/docs/:id` | yes | bilingual docs viewer |
| `/admin/signin` | yes | OAuth entry |
| `/admin` | requires sign-in | list user's orgs |
| `/admin/:org/*` | requires org membership | dashboard (read-only for member, full for admin) |
