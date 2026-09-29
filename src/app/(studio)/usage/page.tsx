import { auth } from "@/auth";
import { usageDashboard } from "@/server/usage";
import { UsageDashboard } from "@/components/usage/UsageDashboard";

export const metadata = { title: "API usage · ReelSmith" };
export const dynamic = "force-dynamic";

export default async function UsagePage() {
  const session = await auth();
  const data = await usageDashboard(session!.user.id);
  return <UsageDashboard data={data} />;
}
