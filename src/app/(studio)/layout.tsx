import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppHeader } from "@/components/site/AppHeader";

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return (
    <div className="min-h-dvh">
      <AppHeader email={session.user.email} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
