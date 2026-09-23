import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withUser } from "@/lib/api";
import { appUrl, getStripe } from "@/lib/stripe";
import { isPro } from "@/lib/plans";

export async function POST() {
  return withUser(async (user) => {
    const stripe = getStripe();
    if (!stripe) return jsonError("Stripe is not configured (STRIPE_SECRET_KEY)", 501);
    if (isPro(user.plan)) return jsonError("You're already on Pro");

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, metadata: { userId: user.id } });
      customerId = customer.id;
      await db.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } });
    }

    const priceId = process.env.STRIPE_PRICE_ID;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: user.id,
      // Use a dashboard price if configured, otherwise an inline $19/mo price (handy for test mode).
      line_items: [
        priceId
          ? { price: priceId, quantity: 1 }
          : {
              quantity: 1,
              price_data: {
                currency: "usd",
                unit_amount: 1900,
                recurring: { interval: "month" },
                product_data: { name: "ReelSmith Pro" },
              },
            },
      ],
      allow_promotion_codes: true,
      success_url: `${appUrl()}/billing?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl()}/billing?canceled=1`,
    });
    return NextResponse.json({ url: session.url });
  });
}
