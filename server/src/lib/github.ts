import { Octokit } from "@octokit/rest";
import { config } from "../config.js";
import { decrypt, encrypt } from "./crypto.js";
import { getState, setState } from "./db.js";

const SERVICE_TOKEN_KEY = "service_token_encrypted";

export function storeServiceToken(token: string) {
  setState(SERVICE_TOKEN_KEY, encrypt(token));
}

export function getServiceToken(): string | null {
  const enc = getState(SERVICE_TOKEN_KEY);
  if (!enc) return null;
  try {
    return decrypt(enc);
  } catch {
    return null;
  }
}

export function octokitWith(token: string): Octokit {
  return new Octokit({ auth: token });
}

export function octokitService(): Octokit {
  const t = getServiceToken();
  if (!t) throw new Error("service token not initialized — admin needs to sign in");
  return octokitWith(t);
}

export const ORG = config.org;
