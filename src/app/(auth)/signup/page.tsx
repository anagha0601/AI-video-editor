import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";

export const metadata = { title: "Create account — ReelSmith" };

export default function SignupPage() {
  return (
    <div className="card p-6">
      <h1 className="mb-1 text-xl font-bold">Make your first video</h1>
      <p className="mb-6 text-sm text-zinc-400">Free forever for 3 videos a month. No card needed.</p>
      <Suspense>
        <AuthForm mode="signup" />
      </Suspense>
    </div>
  );
}
