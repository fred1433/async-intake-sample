/**
 * Browser storage of this sample. Everything here is per browser and per
 * device: it is what lets the parent resume a form in the same browser, and
 * what keeps the reviewer's work between page loads. A production build would
 * keep these records on the server, per user, with an access log.
 */
export const SUBMISSION_KEY = "async-intake:submission:v1";
export const REVIEW_KEY = "async-intake:review:v6";
export const INTAKE_PREFIX = "async-intake:intake:v1:";
export const LANG_KEY = "async-intake:lang";

export function loadJSON<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveJSON(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage unavailable: nothing to remove.
  }
}

export function listKeys(prefix: string): string[] {
  try {
    const out: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(prefix)) out.push(key);
    }
    return out;
  } catch {
    return [];
  }
}

/** A short code a parent can type back: no ambiguous letters. */
export function newResumeCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  const random = new Uint32Array(4);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(random);
  for (let i = 0; i < 4; i++) {
    const n = random[i] || Math.floor(Math.random() * 1_000_000);
    code += alphabet[n % alphabet.length];
  }
  return `SB-${code}`;
}
