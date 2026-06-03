import { Redis } from '@upstash/redis';
import { createClerkClient } from '@clerk/backend';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

const PRODUCT_CREDITS = {
  'Starter Pack — 10 Credits': 10,
  'Power Pack — 100 Credits': 100,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.WHOP_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const event = req.body;
  if (event.action !== 'payment.completed') return res.status(200).json({ received: true });

  const { product, user } = event.data;
  const buyerEmail = user?.email;
  if (!buyerEmail) return res.status(400).json({ error: 'No email provided' });

  const creditsToAdd = PRODUCT_CREDITS[product?.name];
  if (!creditsToAdd) return res.status(400).json({ error: 'Unknown product' });

  const { data: users } = await clerk.users.getUserList({ emailAddress: [buyerEmail] });
  if (!users || users.length === 0) {
    await redis.set(`pending-credits:${buyerEmail}`, creditsToAdd);
    return res.status(200).json({ success: true, pending: true });
  }

  const userId = users[0].id;
  const newTotal = await redis.incrby(`credits:${userId}`, creditsToAdd);
  return res.status(200).json({ success: true, credits: newTotal });
}
