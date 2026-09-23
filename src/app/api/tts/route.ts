import { z } from "zod";
import { jsonError, withUser } from "@/lib/api";
import { isPro } from "@/lib/plans";

const Body = z.object({ text: z.string().trim().min(1).max(800) });

// AI voiceover for exports (Pro). Returns an MP3 of one scene's narration.
export async function POST(req: Request) {
  return withUser(async (user) => {
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) return jsonError("AI voiceover is not configured (ELEVENLABS_API_KEY)", 501);
    if (!isPro(user.plan)) return jsonError("AI voiceover is a Pro feature", 402, { upgrade: true });

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError("Missing text");

    const voice = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text: parsed.data.text, model_id: "eleven_multilingual_v2" }),
    });
    if (!res.ok) return jsonError(`Voice provider error (${res.status})`, 502);
    return new Response(res.body, { headers: { "Content-Type": "audio/mpeg" } });
  });
}
