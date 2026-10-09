import "server-only";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { HttpError } from "./http";

// Server-side downloads of user-supplied links. Guarded against SSRF: http(s) only,
// public addresses only (checked on every redirect), a content-type check and a size cap.

function isPrivate(ip: string) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:127.") || v.startsWith("::ffff:10.") || v.startsWith("::ffff:192.168.");
}

export async function assertPublic(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new HttpError(400, "Only http(s) links can be imported");
  const addrs = await lookup(url.hostname, { all: true }).catch(() => []);
  if (!addrs.length || addrs.some((a) => isPrivate(a.address))) throw new HttpError(400, "That address can't be imported");
}

export async function safeDownload(raw: string, opts: { maxBytes: number; accept: (type: string, url: URL) => boolean; what: string; timeoutMs?: number }) {
  let url = new URL(raw);
  const mb = Math.round(opts.maxBytes / 1024 / 1024);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(url);
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000), headers: { "User-Agent": "Mozilla/5.0 ReelSmith-import" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok) throw new HttpError(400, `Couldn't download the ${opts.what} (${res.status})`);
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!opts.accept(type, url)) throw new HttpError(400, `That link isn't ${/^[aeiou]/.test(opts.what) ? "an" : "a"} ${opts.what}`);
    if (Number(res.headers.get("content-length") ?? 0) > opts.maxBytes) throw new HttpError(413, `The ${opts.what} is too large (${mb} MB max)`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > opts.maxBytes) throw new HttpError(413, `The ${opts.what} is too large (${mb} MB max)`);
    return { buf, type, url };
  }
  throw new HttpError(400, "Too many redirects");
}
