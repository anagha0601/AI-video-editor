import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getOwnedProject, serializeProject } from "@/lib/api";
import { stockEnabled, voiceEnabled } from "@/lib/media";
import { isPro } from "@/lib/plans";
import { Editor } from "@/components/Editor";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const user = (await getCurrentUser())!;
  const project = await getOwnedProject(user.id, (await params).id);
  if (!project) notFound();
  return (
    <Editor
      key={project.id}
      initial={serializeProject(project)}
      pro={isPro(user.plan)}
      stockEnabled={stockEnabled()}
      voiceEnabled={voiceEnabled()}
    />
  );
}
