"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, History, Loader2, RotateCcw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Timeline } from "@/lib/timeline/types";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useEditor } from "./store";

interface VersionRow {
  id: string;
  name: string;
  kind: string;
  createdAt: string;
  _count?: { renders: number };
}

export function VersionsDialog() {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const projectId = useEditor((s) => s.projectId);
  const router = useRouter();

  const load = () =>
    api<{ versions: VersionRow[] }>(`/api/projects/${projectId}/versions`)
      .then((r) => setVersions(r.versions))
      .catch((e) => toast.error(e.message));

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const snapshot = async (n: string, kind: "manual" | "before-restore" = "manual") =>
    api(`/api/projects/${projectId}/versions`, { method: "POST", json: { name: n, json: useEditor.getState().timeline, kind } });

  const save = async () => {
    const n = name.trim() || `Version · ${new Date().toLocaleString()}`;
    setBusy("save");
    try {
      await snapshot(n);
      setName("");
      toast.success(`Saved “${n}”`);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const restore = async (v: VersionRow) => {
    setBusy(v.id);
    try {
      const { version } = await api<{ version: { json: Timeline } }>(`/api/projects/${projectId}/versions/${v.id}`);
      await snapshot(`Before restoring “${v.name}”`, "before-restore");
      const s = useEditor.getState();
      s.commit(version.json, `Restore ${v.name}`);
      s.select([]);
      toast.success(`Restored “${v.name}” (undo to go back)`);
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const duplicate = async (v: VersionRow) => {
    setBusy(v.id);
    try {
      const r = await api<{ projectId: string }>(`/api/projects/${projectId}/versions/${v.id}`, { method: "POST", json: { action: "duplicate" } });
      toast.success("Duplicated as a new project");
      router.push(`/projects/${r.projectId}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (v: VersionRow) => {
    if (!confirm(`Delete version “${v.name}”?`)) return;
    try {
      await api(`/api/projects/${projectId}/versions/${v.id}`, { method: "DELETE" });
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <History /> <span className="hidden lg:inline">Versions</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Versions</DialogTitle>
          <DialogDescription>Named snapshots of this timeline. Every render also saves the exact version it was made from.</DialogDescription>
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this version (e.g. Tighter intro)" />
          <Button type="submit" disabled={busy === "save"}>
            {busy === "save" ? <Loader2 className="animate-spin" /> : <Save />} Save
          </Button>
        </form>
        <div className="max-h-[50vh] space-y-1 overflow-y-auto">
          {versions === null ? (
            <div className="flex justify-center py-6">
              <Loader2 className="animate-spin text-muted-foreground" />
            </div>
          ) : (
            versions.map((v) => (
              <div key={v.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{v.name}</div>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    {new Date(v.createdAt).toLocaleString()}
                    {v.kind !== "manual" && <Badge variant="secondary" className="h-4 px-1 text-[10px]">{v.kind}</Badge>}
                    {v._count?.renders ? <Badge variant="outline" className="h-4 px-1 text-[10px]">{v._count.renders} render{v._count.renders > 1 ? "s" : ""}</Badge> : null}
                  </div>
                </div>
                <Button size="sm" variant="secondary" disabled={busy === v.id} onClick={() => restore(v)} title="Restore into the editor">
                  {busy === v.id ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy === v.id} onClick={() => duplicate(v)} title="Duplicate as a new project">
                  <Copy />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(v)} title="Delete" disabled={Boolean(v._count?.renders)}>
                  <Trash2 />
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
