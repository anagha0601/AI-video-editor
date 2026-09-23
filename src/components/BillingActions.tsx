"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function UpgradeButton({ className = "btn-primary w-full" }: { className?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function go() {
    setLoading(true);
    setError("");
    const res = await fetch("/api/stripe/checkout", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.url) return (window.location.href = data.url);
    setLoading(false);
    setError(data.error ?? "Couldn't start checkout");
  }
  return (
    <div>
      <button onClick={go} disabled={loading} className={className}>
        {loading ? "Redirecting to checkout…" : "Upgrade to Pro"}
      </button>
      {error && <p className="mt-2 text-center text-xs text-red-300">{error}</p>}
    </div>
  );
}

export function ManageButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function go() {
    setLoading(true);
    const res = await fetch("/api/stripe/portal", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.url) return (window.location.href = data.url);
    setLoading(false);
    setError(data.error ?? "Couldn't open billing portal");
  }
  return (
    <div>
      <button onClick={go} disabled={loading} className="btn-ghost w-full">
        {loading ? "Opening…" : "Manage subscription"}
      </button>
      {error && <p className="mt-2 text-center text-xs text-red-300">{error}</p>}
    </div>
  );
}

// Confirms a returning Checkout session so Pro activates immediately, even without webhooks locally.
export function CheckoutReturn() {
  const params = useSearchParams();
  const router = useRouter();
  const sessionId = params.get("session_id");
  const [state, setState] = useState<"idle" | "ok" | "error">("idle");
  const ran = useRef(false);

  useEffect(() => {
    if (!sessionId || ran.current) return;
    ran.current = true;
    fetch("/api/stripe/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    }).then((res) => {
      setState(res.ok ? "ok" : "error");
      router.replace("/billing");
      router.refresh();
    });
  }, [sessionId, router]);

  if (params.get("canceled")) return <Banner tone="zinc">Checkout canceled — no charge was made.</Banner>;
  if (state === "ok") return <Banner tone="emerald">🎉 You&apos;re on Pro. Unlimited videos, no watermark.</Banner>;
  if (state === "error") return <Banner tone="red">We couldn&apos;t confirm your payment yet. It may take a minute — refresh shortly.</Banner>;
  if (sessionId) return <Banner tone="zinc">Confirming your upgrade…</Banner>;
  return null;
}

function Banner({ tone, children }: { tone: "zinc" | "emerald" | "red"; children: React.ReactNode }) {
  const cls = {
    zinc: "bg-white/5 text-zinc-300",
    emerald: "bg-emerald-500/10 text-emerald-300",
    red: "bg-red-500/10 text-red-300",
  }[tone];
  return <div className={`mx-auto mb-8 max-w-3xl rounded-xl px-4 py-3 text-center text-sm ${cls}`}>{children}</div>;
}
