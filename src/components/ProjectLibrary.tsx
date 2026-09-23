"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ProjectDTO } from "@/lib/api";
import { STYLES } from "@/lib/types";
import { ProjectThumb } from "./ProjectThumb";

const STATUS: Record<string, string> = {
  draft: "bg-zinc-500/20 text-zinc-300",
  ready: "bg-emerald-500/15 text-emerald-300",
  exported: "bg-brand-500/20 text-brand-400",
};

function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function ProjectLibrary({ initial }: { initial: ProjectDTO[] }) {
  const [projects, setProjects] = useState(initial);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [style, setStyle] = useState("all");
  const [sort, setSort] = useState("newest");
  const [loading, setLoading] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      setLoading(true);
      const params = new URLSearchParams({ q, status, style, sort });
      const res = await fetch(`/api/projects?${params}`, { signal: ctrl.signal }).catch(() => null);
      if (res?.ok) setProjects((await res.json()).projects);
      setLoading(false);
    }, 250);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [q, status, style, sort]);

  async function remove(id: string) {
    if (!confirm("Delete this video? This can't be undone.")) return;
    const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (res.ok) setProjects((p) => p.filter((x) => x.id !== id));
  }

  const filtered = q || status !== "all" || style !== "all";

  if (!initial.length && !filtered && !projects.length) {
    return (
      <div className="card flex flex-col items-center px-6 py-20 text-center">
        <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-brand-600/30 to-accent-500/30 text-3xl">
          🎬
        </div>
        <h2 className="text-xl font-semibold">No videos yet</h2>
        <p className="mt-2 max-w-sm text-zinc-400">
          Type an idea like “why cats knock things off tables” and get a captioned, ready-to-post short in under a minute.
        </p>
        <Link href="/create" className="btn-primary mt-6 px-6">
          ✨ Create your first video
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <svg className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles, prompts, captions…" className="input pl-9" />
        </div>
        <div className="grid grid-cols-3 gap-2 sm:flex">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="input sm:w-32">
            <option value="all">All status</option>
            <option value="ready">Ready</option>
            <option value="exported">Exported</option>
            <option value="draft">Draft</option>
          </select>
          <select value={style} onChange={(e) => setStyle(e.target.value)} className="input sm:w-36">
            <option value="all">All styles</option>
            {STYLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="input sm:w-32">
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="card px-6 py-16 text-center text-zinc-400">
          No videos match those filters.{" "}
          <button
            className="text-brand-400 hover:underline"
            onClick={() => {
              setQ("");
              setStatus("all");
              setStyle("all");
            }}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className={`grid grid-cols-2 gap-4 transition sm:grid-cols-3 lg:grid-cols-5 ${loading ? "opacity-60" : ""}`}>
          {projects.map((p) => (
            <div key={p.id} className="group relative">
              <Link href={`/projects/${p.id}`} className="block">
                <div className="transition group-hover:scale-[1.02]">
                  <ProjectThumb scene={p.scenes[0]} aspect={p.aspect} />
                </div>
                <div className="mt-2.5 flex items-start justify-between gap-2">
                  <h3 className="line-clamp-2 text-sm font-semibold leading-snug">{p.title}</h3>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS[p.status]}`}>
                    {p.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  {p.durationSec}s · {p.scenes.length} scenes · {timeAgo(p.createdAt)}
                </p>
              </Link>
              <button
                onClick={() => remove(p.id)}
                className="absolute right-2 top-2 rounded-lg bg-black/60 px-2 py-1 text-xs text-zinc-300 opacity-0 transition hover:text-red-300 group-hover:opacity-100 focus:opacity-100"
                aria-label="Delete video"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
