import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withUser } from "@/lib/api";
import { getStripe } from "@/lib/stripe";

// Called by the billing page after Checkout redirects back. Lets upgrades work
// locally even when the webhook isn't forwarded; the webhook remains the source
// of truth for renewals and cancellations.
export async function POST(req: Request) {
  return withUser(async (user) => {
    const stripe = getStripe();
    if (!stripe) return jsonError("Stripe is not configured", 501);
    const { sessionId } = (await req.json().catch(() => ({}))) as { sessionId?: string };
    if (!sessionId) return jsonError("Missing session id");

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.client_reference_id !== user.id) return jsonError("Session does not belong to you", 403);
    if (session.status !== "complete") return jsonError("Checkout not completed", 409);

    await db.user.update({
      where: { id: user.id },
      data: {
        plan: "pro",
        stripeSubId: typeof session.subscription === "string" ? session.subscription : session.subscription?.id,
      },
    });
    return NextResponse.json({ ok: true });
  });
}
