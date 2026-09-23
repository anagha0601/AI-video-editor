// Quick sanity check for your Gemini key: `npm run check:ai`
import fs from "node:fs";
import { GoogleGenAI } from "@google/genai";

// Minimal .env reader so this script has no extra dependencies.
for (const line of fs.readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const key = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
if (!key) {
  console.error("✗ GEMINI_API_KEY is empty in .env — get one at https://aistudio.google.com/apikey");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: key });
try {
  const res = await ai.models.generateContent({
    model,
    contents: "Reply with a JSON object {\"ok\": true, \"hook\": \"<a 6-word video hook about coffee>\"}",
    config: { responseMimeType: "application/json" },
  });
  console.log(`✓ Gemini works (model: ${model})`);
  console.log(res.text);
} catch (err) {
  console.error(`✗ Gemini call failed (model: ${model}): ${err.status ?? ""} ${err.message}`);
  if (err.status === 404) console.error("  Try a different GEMINI_MODEL, e.g. gemini-2.5-flash");
  process.exit(1);
}
