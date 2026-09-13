import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

type Attempt = { id: string; state: string; github_invitation_id: number | null };
export class InviteReservationError extends Error {
  constructor(public statusCode: number, public code: string) { super(code); }
}
/** Reserve synchronously. Never hold a SQLite transaction over an external await. */
export function reserveInvite(db: Database.Database, token: string, recipient: string): Attempt {
  return db.transaction(() => {
    const old = db.prepare("SELECT * FROM invite_attempts WHERE token = ? AND recipient = ?").get(token, recipient) as Attempt | undefined;
    if (old?.state === "sent") return old;
    if (old && old.state !== "failed") throw new InviteReservationError(409, "invite_pending_review");
    const change = db.prepare("UPDATE invite_links SET current_uses = current_uses + 1 WHERE token = ? AND disabled = 0 AND expires_at > ? AND current_uses < max_uses").run(token, Date.now());
    if (!change.changes) throw new InviteReservationError(409, "invite_unavailable");
    const id = old?.id ?? randomUUID();
    db.prepare("INSERT INTO invite_attempts(id, token, recipient, state, created_at) VALUES (?, ?, ?, 'reserved', ?) ON CONFLICT(token, recipient) DO UPDATE SET state = 'reserved', created_at = excluded.created_at").run(id, token, recipient, Date.now());
    return { id, state: "reserved", github_invitation_id: null };
  })();
}

export function failInvite(db: Database.Database, id: string, token: string, outcomeKnown: boolean) {
  db.transaction(() => {
    const change = db.prepare("UPDATE invite_attempts SET state = ? WHERE id = ? AND state = 'reserved'").run(outcomeKnown ? "failed" : "unknown", id);
    if (outcomeKnown && change.changes) db.prepare("UPDATE invite_links SET current_uses = MAX(0, current_uses - 1) WHERE token = ?").run(token);
  })();
}
