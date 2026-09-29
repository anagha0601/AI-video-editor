import Link from "next/link";
import { AlertTriangle, OctagonAlert } from "lucide-react";
import { budgetStatus } from "@/server/usage";
import { cn } from "@/lib/utils";

/** App-wide warning at 80% and 100% of MONTHLY_BUDGET_USD (renders nothing below 80%). */
export async function BudgetBanner() {
  let s;
  try {
    s = await budgetStatus();
  } catch {
    return null;
  }
  if (!s.budget || s.pct < 0.8) return null;
  const over = s.pct >= 1;
  const Icon = over ? OctagonAlert : AlertTriangle;
  return (
    <div
      role="alert"
      className={cn(
        "flex items-center justify-center gap-2 px-4 py-1.5 text-center text-xs font-medium",
        over ? "bg-red-600 text-white" : "bg-amber-400 text-black",
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span>
        {over ? "Monthly AI budget exceeded" : "Approaching monthly AI budget"}: ${s.spent.toFixed(2)} of ${s.budget.toFixed(2)} ({Math.round(s.pct * 100)}%).
      </span>
      <Link href="/usage" className="underline underline-offset-2">
        View usage
      </Link>
    </div>
  );
}
