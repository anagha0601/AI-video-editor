// Quick sanity check for your AI key: `npm run check:ai`
// Tests whichever provider the app will use (Groq > Gemini).
import fs from "node:fs";

// Minimal .env reader so this script has no extra dependencies.
for (const line of fs.readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const PROMPT = 'Reply with a JSON object {"ok": true, "hook": "<a 6-word video hook about coffee>"}';

async function checkGroq() {
  const { default: Groq } = await import("groq-sdk");
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  try {
    const res = await groq.chat.completions.create({
      model,
      messages: [{ role: "user", content: PROMPT }],
      response_format: { type: "json_object" },
    });
    console.log(`✓ Groq works (model: ${model})`);
    console.log(res.choices[0]?.message?.content);
  } catch (err) {
    console.error(`✗ Groq call failed (model: ${model}): ${err.status ?? ""} ${err.message}`);
    if (err.status === 404 || err.status === 400) {
      const list = await groq.models.list().catch(() => null);
      if (list) console.error("  Available models (set one as GROQ_MODEL in .env):\n  " + list.data.map((m) => m.id).join("\n  "));
    }
    process.exit(1);
  }
}

async function checkGemini() {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const model = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
  try {
    const res = await ai.models.generateContent({ model, contents: PROMPT, config: { responseMimeType: "application/json" } });
    console.log(`✓ Gemini works (model: ${model})`);
    console.log(res.text);
  } catch (err) {
    console.error(`✗ Gemini call failed (model: ${model}): ${err.status ?? ""} ${err.message}`);
    if (err.status === 404) console.error("  Try a different GEMINI_MODEL, e.g. gemini-flash-lite-latest");
    process.exit(1);
  }
}

if (process.env.GROQ_API_KEY) await checkGroq();
else if (process.env.GEMINI_API_KEY) await checkGemini();
else {
  console.error("✗ No AI key in .env. Add GROQ_API_KEY (free at https://console.groq.com/keys).");
  process.exit(1);
}
