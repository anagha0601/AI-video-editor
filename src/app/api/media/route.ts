import { MEDIA_HOSTS } from "@/lib/media";

// Same-origin image proxy so <canvas> can export frames without CORS tainting.
// Restricted to known stock hosts to avoid becoming an open proxy.
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("u");
  if (!raw) return new Response("Missing url", { status: 400 });
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new Response("Bad url", { status: 400 });
  }
  if (target.protocol !== "https:" || !MEDIA_HOSTS.includes(target.hostname)) {
    return new Response("Host not allowed", { status: 403 });
  }
  const upstream = await fetch(target, { cache: "force-cache" });
  if (!upstream.ok || !upstream.body) return new Response("Upstream error", { status: 502 });
  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
      "Cache-Control": "public, max-age=604800, immutable",
    },
  });
}
