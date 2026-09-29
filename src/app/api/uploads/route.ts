import { nanoid } from "nanoid";
import { z } from "zod";
import { HttpError, requireUserId, route } from "@/server/http";
import { presignUpload, safeName } from "@/server/storage";

const body = z.object({
  name: z.string().min(1).max(200),
  contentType: z.string().min(1).max(120),
  kind: z.enum(["voice", "video", "image", "music", "audio", "thumb"]),
});

const ALLOWED = /^(video|audio|image)\//;

/** Presigned direct upload: the browser PUTs the file to `uploadUrl`, then registers it. */
export const POST = route(async (req: Request) => {
  const userId = await requireUserId();
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new HttpError(400, "Invalid upload request");
  const { name, contentType, kind } = parsed.data;
  if (!ALLOWED.test(contentType)) throw new HttpError(400, "Only video, audio and image files are supported");
  const key = `u/${userId}/${kind}/${nanoid(12)}-${safeName(name)}`;
  return presignUpload(key, contentType);
});
