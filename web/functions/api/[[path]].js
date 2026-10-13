// Cloudflare Pages Function: proxies /api/* to the Python backend (Hugging Face
// Space, Render, ...). Keeps the UI and API on one origin (no CORS), hides the
// backend URL, and adds the shared secret the backend requires in public mode.
//
// Pages env vars: BACKEND_URL (e.g. https://you-codecopilot.hf.space), PROXY_SECRET.
export async function onRequest({ request, env }) {
  if (!env.BACKEND_URL || !env.PROXY_SECRET) {
    return Response.json({ detail: "Proxy is not configured (BACKEND_URL / PROXY_SECRET)." }, { status: 500 });
  }
  const url = new URL(request.url);
  const target = env.BACKEND_URL.replace(/\/$/, "") + url.pathname + url.search;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("cookie");
  headers.set("X-Proxy-Secret", env.PROXY_SECRET);
  // CF-Connecting-IP is set by Cloudflare and can't be forged by the visitor.
  headers.set("X-Visitor-IP", request.headers.get("CF-Connecting-IP") ?? "");

  let res;
  try {
    res = await fetch(target, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "manual",
    });
  } catch {
    return Response.json({ detail: "The demo server is waking up. Give it a minute and try again." }, { status: 503 });
  }

  // A sleeping Hugging Face Space answers with an HTML splash page, not JSON.
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok && !type.includes("json")) {
    return Response.json({ detail: "The demo server is waking up. Give it a minute and try again." }, { status: 503 });
  }

  // Pass the body through untouched so answer streaming (SSE) works.
  const out = new Headers(res.headers);
  out.set("Cache-Control", "no-store");
  return new Response(res.body, { status: res.status, headers: out });
}
