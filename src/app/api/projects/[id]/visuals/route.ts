import { NextResponse } from "next/server";
import { z } from "zod";
import { getOwnedProject, jsonError, withUser } from "@/lib/api";
import { findStockImage, stockEnabled } from "@/lib/media";

const Body = z.object({ query: z.string().trim().min(2).max(120) });

// Finds a new stock image for a scene. The client saves it via PATCH.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (user) => {
    const project = await getOwnedProject(user.id, (await params).id);
    if (!project) return jsonError("Not found", 404);
    if (!stockEnabled()) return jsonError("Add PEXELS_API_KEY to enable stock visuals", 400);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError("Enter a search query");
    const img = await findStockImage(parsed.data.query, project.aspect);
    if (!img) return jsonError("No visuals found for that search — try different words", 404);
    return NextResponse.json(img);
  });
}
