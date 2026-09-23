import { PLANS } from "@/lib/plans";

export function Pricing({ cta }: { cta: (plan: "free" | "pro") => React.ReactNode }) {
  return (
    <div className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-2">
      {(["free", "pro"] as const).map((id) => {
        const plan = PLANS[id];
        const pro = id === "pro";
        return (
          <div
            key={id}
            className={`relative flex flex-col rounded-2xl border p-6 ${
              pro ? "border-brand-500/60 bg-gradient-to-b from-brand-600/15 to-zinc-900/60" : "border-white/10 bg-zinc-900/60"
            }`}
          >
            {pro && (
              <span className="absolute -top-3 left-6 rounded-full bg-gradient-to-r from-brand-600 to-accent-500 px-3 py-1 text-xs font-bold">
                Most popular
              </span>
            )}
            <h3 className="text-lg font-semibold">{plan.name}</h3>
            <p className="mt-2">
              <span className="text-4xl font-bold">{plan.price}</span>
              <span className="text-zinc-400"> / month</span>
            </p>
            <ul className="my-6 flex-1 space-y-2.5 text-sm text-zinc-300">
              {plan.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className={pro ? "text-brand-400" : "text-zinc-500"}>✓</span>
                  {f}
                </li>
              ))}
            </ul>
            {cta(id)}
          </div>
        );
      })}
    </div>
  );
}
