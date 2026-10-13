// Visitor's own Gemini key (bring-your-own-key). Lives only in this browser.
const KEY = "cc.geminiKey";

export function getUserKey(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setUserKey(value: string | null): void {
  try {
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}
