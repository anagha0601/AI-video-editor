import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { monthlyUsage } from "@/lib/usage";
import { FREE_MONTHLY_VIDEOS, isPro } from "@/lib/plans";
import { AppNav } from "@/components/AppNav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const used = await monthlyUsage(user.id);

  return (
    <div className="min-h-screen">
      <AppNav email={user.email} pro={isPro(user.plan)} used={used} limit={FREE_MONTHLY_VIDEOS} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
