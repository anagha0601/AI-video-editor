import "server-only";
import { promises as fs } from "node:fs";
import { geminiJson, hasGemini } from "./gemini";
import { driver, keyFromUrl, localPath } from "./storage";

async function imageBytes(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const key = keyFromUrl(url);
    if (key && driver() === "local") {
      const buf = await fs.readFile(localPath(key));
      return { data: buf.toString("base64"), mimeType: url.endsWith(".png") ? "image/png" : "image/jpeg" };
    }
    if (!/^https?:/.test(url)) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 6_000_000) return null;
    return { data: buf.toString("base64"), mimeType: res.headers.get("content-type") ?? "image/jpeg" };
  } catch {
    return null;
  }
}

/** Filmable tags for an uploaded photo/video (from its thumbnail) so auto-matching can find it. */
export async function autoTags(imageUrl: string | null | undefined): Promise<string[]> {
  if (!hasGemini() || !imageUrl) return [];
  const img = await imageBytes(imageUrl);
  if (!img) return [];
  try {
    const res = await Promise.race([
      geminiJson<{ tags: string[] }>({
        system: "You tag media for a video editor's search. Return 5-10 short lowercase tags: subjects, objects, setting, action, mood, colors. Single words or two-word phrases.",
        parts: [{ inlineData: img }, { text: "Tag this image." }],
        schema: { type: "object", properties: { tags: { type: "array", items: { type: "string" } } }, required: ["tags"] },
        temperature: 0.2,
      }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 12_000)),
    ]);
    return [...new Set(res.tags.map((t) => t.toLowerCase().trim()).filter(Boolean))].slice(0, 10);
  } catch (err) {
    console.error("[tags] failed", err);
    return [];
  }
}

export function nameTags(name: string) {
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .split(/[^a-z]+/)
    .filter((w) => w.length > 2 && !/^(img|vid|dsc|mov|pxl|mvimg|screenshot|video|photo|image)$/.test(w));
}
