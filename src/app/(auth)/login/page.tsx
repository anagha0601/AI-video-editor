import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";

export const metadata = { title: "Sign in — ReelSmith" };

export default function LoginPage() {
  return (
    <div className="card p-6">
      <h1 className="mb-1 text-xl font-bold">Welcome back</h1>
      <p className="mb-6 text-sm text-zinc-400">Sign in to keep creating.</p>
      <Suspense>
        <AuthForm mode="login" />
      </Suspense>
    </div>
  );
}
