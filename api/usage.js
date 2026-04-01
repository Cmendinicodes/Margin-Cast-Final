import { verifyToken } from "@clerk/backend";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export async function handleUsage(req, res) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  let userId;
  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
      authorizedParties: [
        "http://localhost:5173",
        "https://margincast.com",
        "https://www.margincast.com",
      ],
    });
    userId = payload.sub;
  } catch (e) {
    console.error("Token verification failed:", e.message);
    return res.status(401).json({ error: "Invalid token", detail: e.message });
  }

  const today = new Date().toISOString().slice(0, 10);
  const key = `usage:${userId}:${today}`;
  const used = Number((await redis.get(key)) ?? 0);

  return res.status(200).json({ used, limit: 5 });
}

export default handleUsage;
