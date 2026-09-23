import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { serializeProject } from "@/lib/api";
import { ProjectLibrary } from "@/components/ProjectLibrary";

export const metadata = { title: "Library — ReelSmith" };

export default async function DashboardPage() {
  const user = (await getCurrentUser())!;
  const projects = await db.project.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const totalSeconds = projects.reduce((a, p) => a + p.durationSec, 0);
  const exported = projects.filter((p) => p.status === "exported").length;

  return (
    <div>
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">
            {user.name ? `Hey ${user.name.split(" ")[0]} 👋` : "Your videos"}
          </h1>
          {projects.length > 0 && (
            <p className="mt-1 text-zinc-400">
              {projects.length} {projects.length === 1 ? "video" : "videos"} ·{" "}
              {totalSeconds < 60 ? `${totalSeconds}s` : `${Math.round(totalSeconds / 60)} min`} of content · {exported} exported
            </p>
          )}
        </div>
        {projects.length > 0 && (
          <Link href="/create" className="btn-primary">
            ✨ New video
          </Link>
        )}
      </div>
      <ProjectLibrary initial={projects.map(serializeProject)} />
    </div>
  );
}
