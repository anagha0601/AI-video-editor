import { NextResponse } from "next/server";
import { jsonError, withUser } from "@/lib/api";
import { appUrl, getStripe } from "@/lib/stripe";

export async function POST() {
  return withUser(async (user) => {
    const stripe = getStripe();
    if (!stripe) return jsonError("Stripe is not configured", 501);
    if (!user.stripeCustomerId) return jsonError("No billing account yet");
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${appUrl()}/billing`,
    });
    return NextResponse.json({ url: session.url });
  });
}
