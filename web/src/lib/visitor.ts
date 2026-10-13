// Anonymous per-browser ID. On the public demo the server uses it (hashed) to
// show each visitor only the shared demo repos plus the repos they added.
// It's not a login: clearing site data or switching browsers starts fresh.
const KEY = "cc.visitorId";
let memoryId: string | null = null; // fallback when storage is blocked

function generate(): string {
  // randomUUID needs a secure context (https/localhost); getRandomValues works everywhere
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function visitorId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = generate();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    memoryId ??= generate();
    return memoryId;
  }
}
