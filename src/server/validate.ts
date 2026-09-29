import "server-only";
import type { Timeline } from "@/lib/timeline/types";
import { HttpError } from "./http";

export function assertTimeline(v: unknown): asserts v is Timeline {
  const t = v as Timeline;
  if (!t || t.version !== 1 || !Array.isArray(t.tracks) || typeof t.width !== "number" || !t.captions)
    throw new HttpError(400, "Invalid timeline JSON");
  if (JSON.stringify(t).length > 8_000_000) throw new HttpError(413, "Timeline too large");
}
