import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import type { Timeline } from "@/lib/timeline/types";
import { prisma } from "@/server/db";
import { Editor } from "@/components/editor/Editor";
import { Processing } from "@/components/dashboard/Processing";
import { BudgetBanner } from "@/components/site/BudgetBanner";

export const metadata = { title: "Editor · ReelSmith" };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;
  const project = await prisma.project.findFirst({
    where: { id, userId: session.user.id },
    include: { timeline: true, voice: { select: { status: true, error: true } } },
  });
  if (!project) notFound();
  const editable = (project.status === "ready" || project.status === "rendered") && project.timeline;
  if (!editable) {
    return <Processing projectId={project.id} title={project.title} initialStatus={project.status} />;
  }
  return (
    <div className="flex h-dvh flex-col">
      <BudgetBanner />
      <div className="min-h-0 flex-1">
        <Editor
          project={{ id: project.id, title: project.title }}
          timeline={project.timeline!.json as unknown as Timeline}
          revision={project.timeline!.revision}
        />
      </div>
    </div>
  );
}
