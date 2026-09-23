"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const res = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form)),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) return setError(data.error ?? "Something went wrong");
    const next = params.get("next");
    router.push(next && next.startsWith("/") ? next : mode === "signup" ? "/create" : "/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {mode === "signup" && (
        <div>
          <label className="mb-1.5 block text-sm text-zinc-400" htmlFor="name">
            Name
          </label>
          <input id="name" name="name" className="input" placeholder="Alex Creator" autoComplete="name" />
        </div>
      )}
      <div>
        <label className="mb-1.5 block text-sm text-zinc-400" htmlFor="email">
          Email
        </label>
        <input id="email" name="email" type="email" required className="input" placeholder="you@example.com" autoComplete="email" />
      </div>
      <div>
        <label className="mb-1.5 block text-sm text-zinc-400" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={mode === "signup" ? 8 : 1}
          className="input"
          placeholder={mode === "signup" ? "At least 8 characters" : "••••••••"}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
        />
      </div>
      {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
      <button className="btn-primary w-full" disabled={loading}>
        {loading ? "Please wait…" : mode === "signup" ? "Create free account" : "Sign in"}
      </button>
      <p className="text-center text-sm text-zinc-400">
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="text-brand-400 hover:underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link href="/signup" className="text-brand-400 hover:underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
