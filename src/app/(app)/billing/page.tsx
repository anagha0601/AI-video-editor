import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { monthlyUsage } from "@/lib/usage";
import { FREE_MONTHLY_VIDEOS, isPro } from "@/lib/plans";
import { Pricing } from "@/components/Pricing";
import { CheckoutReturn, ManageButton, UpgradeButton } from "@/components/BillingActions";

export const metadata = { title: "Billing — ReelSmith" };

export default async function BillingPage() {
  const user = (await getCurrentUser())!;
  const pro = isPro(user.plan);
  const used = await monthlyUsage(user.id);
  const stripeReady = Boolean(process.env.STRIPE_SECRET_KEY);

  return (
    <div>
      <Suspense>
        <CheckoutReturn />
      </Suspense>
      <div className="mb-10 text-center">
        <h1 className="text-2xl font-bold sm:text-3xl">Plans & billing</h1>
        <p className="mt-2 text-zinc-400">
          {pro ? (
            <>You&apos;re on <b className="text-white">Pro</b>. {used} videos created this month.</>
          ) : (
            <>
              You&apos;re on <b className="text-white">Free</b> — {used} of {FREE_MONTHLY_VIDEOS} videos used this month.
            </>
          )}
        </p>
        {!pro && (
          <div className="mx-auto mt-4 h-2 max-w-xs overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full bg-gradient-to-r from-brand-600 to-accent-500"
              style={{ width: `${Math.min(100, (used / FREE_MONTHLY_VIDEOS) * 100)}%` }}
            />
          </div>
        )}
      </div>
      <Pricing
        cta={(plan) =>
          plan === "free" ? (
            <div className="btn-ghost w-full cursor-default">{pro ? "Included" : "Current plan"}</div>
          ) : pro ? (
            user.stripeCustomerId ? <ManageButton /> : <div className="btn-ghost w-full cursor-default">Current plan</div>
          ) : (
            <UpgradeButton />
          )
        }
      />
      {!stripeReady && (
        <p className="mx-auto mt-6 max-w-md text-center text-xs text-zinc-500">
          Stripe isn&apos;t configured yet. Add <code>STRIPE_SECRET_KEY</code> (test mode) to <code>.env</code> to enable checkout.
        </p>
      )}
      {stripeReady && !pro && (
        <p className="mt-6 text-center text-xs text-zinc-500">
          Test mode: use card <code className="text-zinc-300">4242 4242 4242 4242</code>, any future date, any CVC.
        </p>
      )}
    </div>
  );
}
