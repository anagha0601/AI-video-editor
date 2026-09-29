"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, OctagonAlert } from "lucide-react";
import type { UsageDashboard as Data } from "@/server/usage";
import { cn } from "@/lib/utils";

// Single-series charts: one hue (reference dark series-1), identity comes from labels.
// Text never wears the data color; status colors are reserved for the budget.
const SERIES = "#3987e5";

export function money(v: number) {
  if (v === 0) return "$0.00";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 100) return `$${v.toFixed(2)}`;
  return `$${Math.round(v).toLocaleString("en-US")}`;
}
const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

const FEATURE_LABEL: Record<string, string> = {
  script: "Script writing",
  scene_split: "Scene splitting",
  ai_edit: "AI edit commands",
  tagging: "Media auto-tags",
  tts: "AI voiceover",
  image: "AI images",
};

export function UsageDashboard({ data }: { data: Data }) {
  const { cards, budget } = data;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">API usage & cost</h1>
        <p className="text-sm text-muted-foreground">Every Gemini call is logged with its token counts. Costs use the prices in src/config/pricing.ts. Days are UTC.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Today" value={cards.today.cost} calls={cards.today.calls} />
        <Stat label="This week" value={cards.week.cost} calls={cards.week.calls} />
        <Stat label="This month" value={cards.month.cost} calls={cards.month.calls} />
        <Stat label="All time" value={cards.all.cost} calls={cards.all.calls} />
      </div>

      <Budget budget={budget} />

      <section className="rounded-xl border bg-card p-4">
        <h2 className="text-sm font-medium">Daily spend · last 30 days</h2>
        <DailyChart daily={data.daily} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-3 text-sm font-medium">By feature</h2>
          <Breakdown rows={data.byFeature.map((r) => ({ ...r, label: FEATURE_LABEL[r.key] ?? r.key }))} />
        </section>
        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-3 text-sm font-medium">By model</h2>
          <Breakdown rows={data.byModel.map((r) => ({ ...r, label: r.key }))} />
        </section>
      </div>

      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">Cost per video</h2>
        <ProjectCosts projects={data.projects} unattributed={data.unattributed} />
      </section>
    </div>
  );
}

function Stat({ label, value, calls }: { label: string; value: number; calls: number }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{money(value)}</div>
      <div className="text-[11px] text-muted-foreground">
        {calls} call{calls === 1 ? "" : "s"}
      </div>
    </div>
  );
}

function Budget({ budget }: { budget: Data["budget"] }) {
  if (!budget.budget) {
    return (
      <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        No monthly budget set. Add <code className="text-foreground">MONTHLY_BUDGET_USD</code> to .env to track spend against a limit (warnings at 80% and 100%).
      </div>
    );
  }
  const pct = budget.pct;
  const state = pct >= 1 ? "over" : pct >= 0.8 ? "warn" : "ok";
  const Icon = state === "over" ? OctagonAlert : state === "warn" ? AlertTriangle : CheckCircle2;
  const tone = state === "over" ? "bg-red-500" : state === "warn" ? "bg-amber-400" : "bg-emerald-500";
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icon className={cn("size-4", state === "over" ? "text-red-400" : state === "warn" ? "text-amber-300" : "text-emerald-400")} />
          Monthly budget · {state === "over" ? "Over budget" : state === "warn" ? "Nearly used" : "On track"}
        </div>
        <div className="text-sm tabular-nums">
          {money(budget.spent)} <span className="text-muted-foreground">of {money(budget.budget)} ({Math.round(pct * 100)}%)</span>
        </div>
      </div>
      <div
        className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={Math.round(pct * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Monthly budget used"
      >
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.min(100, pct * 100)}%` }} />
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">Across all accounts on this app (it&apos;s one API key&apos;s bill). Resets on the 1st, UTC.</p>
    </div>
  );
}

function niceMax(v: number) {
  if (v <= 0) return 0.01;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function DailyChart({ daily }: { daily: Data["daily"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(...daily.map((d) => d.cost)));
  const ticks = [0, max / 2, max];
  const H = 180;
  const fmtDay = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const total = daily.reduce((a, d) => a + d.cost, 0);
  return (
    <div className="mt-3">
      <div className="relative flex gap-2">
        <div className="relative w-14 shrink-0" style={{ height: H }}>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2 text-[10px] text-muted-foreground tabular-nums" style={{ top: H - (t / max) * H }}>
              {money(t)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1" style={{ height: H }} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <div key={t} className="absolute inset-x-0 border-t border-white/[0.07]" style={{ top: H - (t / max) * H }} />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {daily.map((d, i) => (
              <div
                key={d.date}
                className="relative flex h-full min-w-0 flex-1 items-end justify-center"
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                tabIndex={0}
                aria-label={`${fmtDay(d.date)}: ${money(d.cost)}, ${d.calls} calls`}
              >
                <div
                  className={cn("w-full max-w-6 rounded-t-[4px] transition-opacity", hover !== null && hover !== i && "opacity-60")}
                  style={{ height: d.cost > 0 ? Math.max(2, (d.cost / max) * H) : 0, background: SERIES }}
                />
              </div>
            ))}
          </div>
          {hover !== null && (
            <div
              className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-md border bg-popover px-2.5 py-1.5 text-xs whitespace-nowrap shadow-lg"
              style={{ left: `${((hover + 0.5) / daily.length) * 100}%` }}
            >
              <div className="text-muted-foreground">{fmtDay(daily[hover].date)}</div>
              <div className="font-medium tabular-nums">{money(daily[hover].cost)}</div>
              <div className="text-muted-foreground">{daily[hover].calls} {daily[hover].calls === 1 ? "call" : "calls"}</div>
            </div>
          )}
        </div>
      </div>
      <div className="mt-1 flex gap-2">
        <div className="w-14 shrink-0" />
        <div className="flex min-w-0 flex-1 justify-between text-[10px] text-muted-foreground">
          {daily.filter((_, i) => i % 7 === 0 || i === daily.length - 1).map((d) => (
            <span key={d.date}>{fmtDay(d.date)}</span>
          ))}
        </div>
      </div>
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted-foreground">
          Show as table · 30-day total {money(total)}
        </summary>
        <table className="mt-2 w-full max-w-md text-left">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 font-normal">Day (UTC)</th>
              <th className="py-1 text-right font-normal">Calls</th>
              <th className="py-1 text-right font-normal">Cost</th>
            </tr>
          </thead>
          <tbody>
            {daily.filter((d) => d.calls).map((d) => (
              <tr key={d.date} className="border-t border-white/5">
                <td className="py-1">{fmtDay(d.date)}</td>
                <td className="py-1 text-right tabular-nums">{d.calls}</td>
                <td className="py-1 text-right tabular-nums">{money(d.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function Breakdown({ rows }: { rows: { label: string; cost: number; calls: number; tokens: { input: number; output: number; thinking: number } }[] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">No calls yet.</p>;
  const max = Math.max(...rows.map((r) => r.cost)) || 1;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label} className="group">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate">{r.label}</span>
            <span className="shrink-0 tabular-nums">{money(r.cost)}</span>
          </div>
          <div className="mt-1 h-3 rounded-[4px] bg-muted/50">
            <div className="h-3 rounded-r-[4px]" style={{ width: `${Math.max(r.cost > 0 ? 1 : 0, (r.cost / max) * 100)}%`, background: SERIES }} />
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {r.calls} {r.calls === 1 ? "call" : "calls"} · {tokens(r.tokens.input)} in · {tokens(r.tokens.output)} out{r.tokens.thinking ? ` · ${tokens(r.tokens.thinking)} thinking` : ""}
          </div>
        </li>
      ))}
    </ul>
  );
}

type SortKey = "cost" | "title" | "calls" | "createdAt";

function ProjectCosts({ projects, unattributed }: { projects: Data["projects"]; unattributed: Data["unattributed"] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "cost", dir: -1 });
  const rows = useMemo(
    () =>
      [...projects].sort((a, b) => {
        const va = a[sort.key];
        const vb = b[sort.key];
        return (typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number)) * sort.dir;
      }),
    [projects, sort],
  );
  const head = (key: SortKey, label: string, right?: boolean) => (
    <th className={cn("py-2 font-normal", right && "text-right")}>
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : key === "title" ? 1 : -1 }))}
        aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
      >
        {label}
        {sort.key === key && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </th>
  );
  if (!projects.length) return <p className="text-sm text-muted-foreground">No projects yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-left text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b">
            {head("title", "Project")}
            {head("createdAt", "Created")}
            {head("calls", "Calls", true)}
            {head("cost", "Cost", true)}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="border-b border-white/5">
              <td className="max-w-64 truncate py-2">
                <Link href={`/projects/${p.id}`} className="hover:underline">
                  {p.title}
                </Link>
              </td>
              <td className="py-2 text-muted-foreground">{new Date(p.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</td>
              <td className="py-2 text-right tabular-nums">{p.calls}</td>
              <td className="py-2 text-right font-medium tabular-nums">{money(p.cost)}</td>
            </tr>
          ))}
          {unattributed.calls > 0 && (
            <tr className="text-muted-foreground">
              <td className="py-2" colSpan={2}>
                Not tied to a project (library tags, AI images made outside a project…)
              </td>
              <td className="py-2 text-right tabular-nums">{unattributed.calls}</td>
              <td className="py-2 text-right tabular-nums">{money(unattributed.cost)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
