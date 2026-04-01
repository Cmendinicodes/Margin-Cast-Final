import Stripe from "stripe";
import { createClerkClient } from "@clerk/backend";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

async function getRawBody(req) {
  // Express with raw() middleware: req.body is already a Buffer
  if (Buffer.isBuffer(req.body)) return req.body;
  // Vercel / plain stream
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export async function handleWebhook(req, res) {
  const sig = req.headers["stripe-signature"];
  if (!sig) return res.status(400).json({ error: "Missing stripe-signature header" });

  let rawBody;
  try { rawBody = await getRawBody(req); }
  catch { return res.status(400).json({ error: "Could not read request body" }); }

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).json({ error: `Webhook verification failed: ${err.message}` });
  }

  const obj = event.data.object;

  try {
    if (
      (event.type === "customer.subscription.created" ||
        event.type === "customer.subscription.updated") &&
      obj.status === "active"
    ) {
      const clerkUserId = obj.metadata?.clerkUserId;
      if (clerkUserId) {
        await clerk.users.updateUser(clerkUserId, { publicMetadata: { plan: "pro" } });
      }
    } else if (event.type === "customer.subscription.deleted") {
      const clerkUserId = obj.metadata?.clerkUserId;
      if (clerkUserId) {
        await clerk.users.updateUser(clerkUserId, { publicMetadata: { plan: "free" } });
      }
    } else if (event.type === "checkout.session.completed") {
      // Fallback: ensure pro is set immediately after checkout
      const clerkUserId = obj.client_reference_id;
      if (clerkUserId) {
        await clerk.users.updateUser(clerkUserId, { publicMetadata: { plan: "pro" } });
      }
    }
  } catch (err) {
    console.error("Error updating Clerk user metadata:", err);
  }

  return res.status(200).json({ received: true });
}

export default handleWebhook;
