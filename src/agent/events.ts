// Turns raw `claude -p --output-format stream-json` lines (plus the runner's own
// {"type":"reelsmith"} marker lines) into small display events for the UI.

export type AgentEvent =
  | { k: "init"; model?: string; sessionId?: string }
  | { k: "text"; text: string }
  | { k: "tool"; name: string; detail: string }
  | { k: "tool_result"; error: boolean; text: string }
  | { k: "result"; ok: boolean; text: string; costUsd?: number; turns?: number; durationMs?: number; denials: string[] }
  | { k: "note"; level: "info" | "warn" | "error"; text: string };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

function toolDetail(name: string, input: Record<string, unknown>): string {
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  switch (name) {
    case "Bash":
      return clip(s("command"), 300);
    case "Read":
    case "Write":
    case "Edit":
      return s("file_path");
    case "Glob":
    case "Grep":
      return [s("pattern"), s("path")].filter(Boolean).join("  in  ");
    case "WebSearch":
      return s("query");
    case "WebFetch":
      return s("url");
    case "Skill":
      return s("skill") || s("command");
    case "TodoWrite":
      return "updated the plan";
    default:
      return clip(JSON.stringify(input), 200);
  }
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : c && typeof c === "object" && "type" in c ? `[${(c as { type: string }).type}]` : ""))
      .join(" ");
  }
  return "";
}

export function toEvents(line: string): AgentEvent[] {
  let e: Record<string, unknown>;
  try {
    e = JSON.parse(line);
  } catch {
    return line.trim() ? [{ k: "note", level: "info", text: clip(line, 500) }] : [];
  }
  const out: AgentEvent[] = [];
  switch (e.type) {
    case "reelsmith":
      out.push({ k: "note", level: (e.level as "info" | "warn" | "error") ?? "info", text: String(e.text ?? "") });
      break;
    case "system":
      if (e.subtype === "init") out.push({ k: "init", model: e.model as string, sessionId: e.session_id as string });
      break;
    case "assistant": {
      const content = ((e.message as { content?: unknown[] })?.content ?? []) as Record<string, unknown>[];
      for (const c of content) {
        if (c.type === "text" && String(c.text).trim()) out.push({ k: "text", text: String(c.text) });
        if (c.type === "tool_use") out.push({ k: "tool", name: String(c.name), detail: toolDetail(String(c.name), (c.input ?? {}) as Record<string, unknown>) });
      }
      break;
    }
    case "user": {
      const content = ((e.message as { content?: unknown })?.content ?? []) as unknown;
      if (Array.isArray(content)) {
        for (const c of content as Record<string, unknown>[]) {
          if (c.type === "tool_result") out.push({ k: "tool_result", error: Boolean(c.is_error), text: clip(resultText(c.content).trim(), 400) });
        }
      }
      break;
    }
    case "result": {
      const denials = ((e.permission_denials as { tool_name: string; tool_input?: Record<string, unknown> }[]) ?? []).map(
        (d) => `${d.tool_name}: ${toolDetail(d.tool_name, d.tool_input ?? {})}`,
      );
      out.push({
        k: "result",
        ok: e.subtype === "success" && !e.is_error,
        text: clip(String(e.result ?? e.subtype ?? ""), 4000),
        costUsd: e.total_cost_usd as number | undefined,
        turns: e.num_turns as number | undefined,
        durationMs: e.duration_ms as number | undefined,
        denials,
      });
      break;
    }
  }
  return out;
}
