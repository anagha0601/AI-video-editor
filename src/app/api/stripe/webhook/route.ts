import type Stripe from "stripe";
import { db } from "@/lib/db";
import { getStripe } from "@/lib/stripe";

export async function POST(req: Request) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return new Response("Stripe webhook not configured", { status: 501 });

  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await req.text(), signature, secret);
  } catch (err) {
    return new Response(`Invalid signature: ${(err as Error).message}`, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object;
      if (s.client_reference_id) {
        await db.user.updateMany({
          where: { id: s.client_reference_id },
          data: {
            plan: "pro",
            stripeSubId: typeof s.subscription === "string" ? s.subscription : s.subscription?.id,
          },
        });
      }
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      const active = event.type === "customer.subscription.updated" && ["active", "trialing"].includes(sub.status);
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      await db.user.updateMany({
        where: { stripeCustomerId: customerId },
        data: { plan: active ? "pro" : "free", stripeSubId: active ? sub.id : null },
      });
      break;
    }
  }
  return new Response("ok");
}
