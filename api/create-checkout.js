import Stripe from "stripe";
import { verifyToken } from "@clerk/backend";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function parseBody(req) {
  if (req.body !== undefined && req.body !== null) {
    return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  }
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk.toString()));
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error("Invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

export async function handleCreateCheckout(req, res) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
      authorizedParties: [
        "http://localhost:5173",
        "https://margincast.com",
        "https://www.margincast.com",
      ],
    });
  } catch (e) {
    console.error("Token verification failed:", e.message);
    return res.status(401).json({ error: "Invalid token", detail: e.message });
  }

  let body;
  try { body = await parseBody(req); }
  catch { return res.status(400).json({ error: "Invalid request body" }); }

  const { userId, email } = body;
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  const origin =
    req.headers.origin ||
    req.headers.referer?.replace(/\/$/, "") ||
    "http://localhost:5173";

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: origin,
    client_reference_id: userId,
    customer_email: email,
    subscription_data: {
      metadata: { clerkUserId: userId },
    },
  });

  return res.status(200).json({ url: session.url });
}

export default handleCreateCheckout;
