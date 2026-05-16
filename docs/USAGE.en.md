# Usage

Live: https://github.yangtzeu.work/

This guide is organized by role: org admin / member / external visitor.

---

## Common: sign in and switch orgs

1. Open the landing page → click "Sign in with GitHub"
2. Authorize OAuth on GitHub
3. You land on `/admin` listing every org you belong to
4. Inside an org, the sidebar shows an org switcher; "All orgs" returns to the picker

Authorization is determined by your live GitHub role per org: admin sees full nav, member sees read-only.

---

## Org admin

### Overview

`/admin/<org>` shows avatar, name, plan, members, repos, pending invites, active invite links.

### Members

`/admin/<org>/members`

- Promote / demote (admin ↔ member)
- Remove (themed confirm)
- Cannot remove yourself

### Invitations (manage pending GitHub invites)

`/admin/<org>/invitations`

Pending GitHub invitations + history of every invite originated from this app (with IP, UA, status).

### Invite links (recommended)

`/admin/<org>/invite-links`

Generate a temporary link with:

- TTL (hours): 1 ~ 8760
- Max uses: 1 ~ 1000
- Note (for your bookkeeping)
- Optional auto-join team

Send the resulting URL (`https://github.yangtzeu.work/join/<token>`) to recipients. Each link can be disabled / enabled / deleted independently of already-sent GitHub invitations.

### Teams

CRUD with privacy (closed = visible to org / secret = members only). Delete shows impact (member + repo count).

### Repos

`/admin/<org>/repos`

Admins see a "New repo" button. Each repo opens into 5 tabs:

- **Code** — branch picker + breadcrumbs + file tree + file viewer (>1MB shows hint)
- **Commits** — per-branch list + click into commit detail with full diff (`+`green / `-`red / `@@`blue)
- **Issues** — embedded list and detail view (title, body, comments) — no GitHub redirect
- **PRs** — embedded list + detail (title, body, diff per file, comments)
- **Settings (admin only)** — branches + protection, collaborator CRUD with permission, webhooks, danger zone delete

### Create repo

`/admin/<org>/repos/new` — name + description + visibility (private/public card-style) + auto init + .gitignore + license templates.

### Activity

Last 100 org events (push / PR / issue / release).

### Security

Dependabot alerts (Pro+), secret scanning + audit log status.

### Org settings

Editable: name, description, company, email, location, blog, twitter, billing email, default repo permission (none/read/write/admin), 8 boolean toggles (create / fork / delete / change visibility). Login rename + avatar must be done on GitHub web.

### Feedback box

`/admin/<org>/feedback` — public submit URL `/feedback/<org>` + global floating button.

Filter chips by status (open / triaged / in_progress / done / wont_do / spam). Each item: change status, write public reply, delete.

### Audit log

Every admin action + key public event lands here with IP, UA, JSON details.

---

## Org member

- Overview: visible
- Members: list visible, action buttons hidden
- Teams: list visible, no create/delete
- Repos: visible; repo detail tabs Code/Commits/Issues/PRs visible; Settings tab hides collaborator and delete buttons
- Activity / Security / Org info: read-only
- Invitations / Invite links / Audit logs / Feedback: hidden in nav

---

## External visitor

### Submit feedback

`https://github.yangtzeu.work/feedback` or `/feedback/<org-login>`, or the global floating button on every page.

- Pick category (建议 / Bug / 新功能 / 投诉 / 其他)
- Write content (5 ~ 5000 chars)
- Optional contact
- Honeypot + client-side PoW + (optional) Cloudflare Turnstile

If you're signed in, `submitter_login` is recorded; otherwise anonymous.

### Accept invite link

Admin sends `https://github.yangtzeu.work/join/<token>` → you open it → fill GitHub username (or email) → submit → invitation lands in your GitHub notification center → accept.

Expired / used-up / disabled links show a clear message.

---

## FAQ

### I sign in but my org doesn't show

GitHub may restrict OAuth Apps per-org. Have the org owner whitelist `Geek Class Admin` at `https://github.com/organizations/<org>/settings/oauth_application_policy`.

### Where is data stored

SQLite at `/opt/yzgc-admin/data/data.db` (WAL). Tables: sessions (encrypted OAuth tokens), invite_links, invitations, feedback, audit_logs.

Tokens are AES-256-GCM encrypted at rest using `ENCRYPTION_KEY` env.

### I deleted an invite link — does it cancel sent invitations

No. Deleting the link only removes our DB row. GitHub invitations already sent are still valid; cancel them on `/admin/<org>/invitations`.

### Theme doesn't seem to switch

Use the bottom-left compact theme button (admin) or top-right theme button (other pages). 10 themes; choice persists in localStorage.

### Loading is slow

Server is in Hong Kong with a 5 Mbps egress. Optimizations done: dropped Google Fonts CDN, system fonts, nginx gzip + 7-day immutable cache for static assets. If still slow from mainland China, use a proxy or front with Cloudflare.
