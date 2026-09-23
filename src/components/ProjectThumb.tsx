import type { Scene } from "@/lib/types";

// Lightweight CSS thumbnail of a project's first scene (no canvas needed for lists).
export function ProjectThumb({ scene, aspect }: { scene?: Scene; aspect: string }) {
  const ratio = aspect === "16:9" ? "aspect-video" : aspect === "1:1" ? "aspect-square" : "aspect-[9/16]";
  const [a, b] = scene?.palette ?? ["#3f3f46", "#18181b"];
  return (
    <div
      className={`relative ${ratio} w-full overflow-hidden rounded-xl`}
      style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}
    >
      {scene?.mediaUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={scene.mediaUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-5xl">{scene?.emoji ?? "🎬"}</div>
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/40" />
      {scene?.onScreen && (
        <div className="absolute inset-x-3 top-[16%] text-center">
          <span className="inline rounded bg-black/55 px-1.5 py-0.5 text-[11px] font-black uppercase leading-snug text-white [box-decoration-break:clone]">
            {scene.onScreen}
          </span>
        </div>
      )}
    </div>
  );
}
