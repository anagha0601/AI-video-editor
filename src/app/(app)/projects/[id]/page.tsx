import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getOwnedProject, serializeProject } from "@/lib/api";
import { stockEnabled, voiceEnabled } from "@/lib/media";
import { isPro } from "@/lib/plans";
import { loadAssetRefs } from "@/lib/storyboard";
import { Editor } from "@/components/Editor";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const user = (await getCurrentUser())!;
  const project = await getOwnedProject(user.id, (await params).id);
  if (!project) notFound();
  const initial = serializeProject(project);
  return (
    <Editor
      key={project.id}
      initial={initial}
      assets={await loadAssetRefs(user.id, initial.assetIds)}
      pro={isPro(user.plan)}
      stockEnabled={stockEnabled()}
      voiceEnabled={voiceEnabled()}
    />
  );
}
