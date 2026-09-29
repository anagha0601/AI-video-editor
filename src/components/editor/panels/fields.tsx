"use client";

import { useEffect, useRef, useState } from "react";
import { findClip } from "@/lib/timeline/derive";
import { updateClip } from "@/lib/timeline/ops";
import type { AnyClip, Timeline } from "@/lib/timeline/types";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useEditor } from "../store";

/**
 * Edits one clip. Continuous controls (sliders) call `live` while dragging and
 * `done` on release, so a whole drag is one undo step; discrete controls `set`.
 */
export function useClipEdit(id: string) {
  const base = useRef<Timeline | null>(null);
  const get = useEditor.getState;
  return {
    live(patch: Partial<AnyClip>) {
      if (!base.current) {
        get().begin();
        base.current = get().timeline;
      }
      get().live(updateClip(base.current, id, patch));
    },
    done(label = "Adjust") {
      if (base.current) {
        get().end(label);
        base.current = null;
      }
    },
    set(patch: Partial<AnyClip>, label = "Edit") {
      get().commit(updateClip(get().timeline, id, patch), label);
    },
    current() {
      return findClip(get().timeline, id)?.clip;
    },
  };
}

/** Same pattern for timeline-level fields (captions, duck level, background). */
export function useTimelineEdit() {
  const base = useRef<Timeline | null>(null);
  const get = useEditor.getState;
  return {
    live(fn: (tl: Timeline) => Timeline) {
      if (!base.current) {
        get().begin();
        base.current = get().timeline;
      }
      get().live(fn(base.current));
    },
    done(label = "Adjust") {
      if (base.current) {
        get().end(label);
        base.current = null;
      }
    },
    set(fn: (tl: Timeline) => Timeline, label = "Edit") {
      get().commit(fn(get().timeline), label);
    },
  };
}

export function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-3 border-b border-white/5 px-4 py-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function SliderField({
  label,
  value,
  min,
  max,
  step = 0.01,
  format = (v) => v.toFixed(2),
  onLive,
  onDone,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onLive: (v: number) => void;
  onDone: () => void;
  disabled?: boolean;
}) {
  return (
    <div className={cn("space-y-1.5", disabled && "opacity-50")}>
      <div className="flex items-center justify-between text-xs">
        <Label className="text-xs font-normal text-muted-foreground">{label}</Label>
        <span className="font-mono text-[11px] tabular-nums">{format(value)}</span>
      </div>
      <Slider disabled={disabled} min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onLive(v)} onValueCommit={() => onDone()} />
    </div>
  );
}

/** Number input that commits on blur / Enter. */
export function NumberField({
  label,
  value,
  onCommit,
  step = 0.1,
  min,
  max,
  suffix,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  const [text, setText] = useState(value.toFixed(2));
  useEffect(() => setText(value.toFixed(2)), [value]);
  const commit = () => {
    const v = Number(text);
    if (!Number.isFinite(v)) return setText(value.toFixed(2));
    const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
    if (Math.abs(c - value) > 1e-6) onCommit(c);
    setText(c.toFixed(2));
  };
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="relative">
        <Input
          type="number"
          step={step}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="h-8 pr-6 font-mono text-xs"
        />
        {suffix && <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px] text-muted-foreground">{suffix}</span>}
      </div>
    </label>
  );
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-mono text-[11px] uppercase">{value}</span>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-7 w-9 cursor-pointer rounded border bg-transparent" />
      </span>
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="grid gap-1 rounded-lg bg-muted p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn("rounded-md px-2 py-1 text-xs transition", value === o.value ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
