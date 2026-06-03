import { createClerkClient, verifyToken } from "@clerk/backend";
import { Redis } from "@upstash/redis";

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const FREE_LIMIT = 5;

async function redeemPendingCredits(userId) {
  const user = await clerk.users.getUser(userId);
  const email = user.emailAddresses[0]?.emailAddress;
  if (!email) return;
  const pending = await redis.get(`pending-credits:${email}`);
  if (pending && parseInt(pending) > 0) {
    await redis.incrby(`credits:${userId}`, parseInt(pending));
    await redis.del(`pending-credits:${email}`);
  }
}

async function getUserId(token) {
  const payload = await verifyToken(token, {
    secretKey: process.env.CLERK_SECRET_KEY,
    authorizedParties: [
      "http://localhost:5173",
      "https://margincast.com",
      "https://www.margincast.com",
    ],
  });
  return payload.sub;
}

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

function buildPrompt(ticker, method, variables) {
  return `You are an expert financial analyst. Perform a ${method} valuation for ${ticker} using these inputs: ${JSON.stringify(variables)}.

Respond with ONLY a raw JSON object. No markdown, no backticks, no explanation, no text before or after. Just the JSON.

The JSON must have exactly these fields:
{
  "companyName": "full company name",
  "ticker": "ticker symbol",
  "currentPrice": 000.00,
  "fairValue": 000.00,
  "updownside": "+00% undervalued" or "-00% overvalued",
  "verdict": "Undervalued" or "Overvalued" or "Fairly Valued",
  "confidence": "High" or "Medium" or "Low",
  "keyMetrics": { "metric1": "value1", "metric2": "value2", "metric3": "value3" },
  "summary": "2-3 sentence analysis",
  "dataNote": "brief note on data sources or assumptions used"
}`;
}

export async function handleRunValuation(req, res) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  let userId;
  try {
    userId = await getUserId(token);
  } catch (e) {
    console.error("Token verification failed:", e.message);
    return res.status(401).json({ error: "Invalid token", detail: e.message });
  }

  let body;
  try { body = await parseBody(req); }
  catch { return res.status(400).json({ error: "Invalid request body" }); }

  const { ticker, method, variables } = body;
  if (!ticker || !method) return res.status(400).json({ error: "Missing ticker or method" });

  const isOwner = userId === 'user_3BlrsXyaM9ASvEietWv2qsU1tVS';

  if (!isOwner) {
    await redeemPendingCredits(userId);

    const credits = Number((await redis.get(`credits:${userId}`)) ?? 0);
    if (credits > 0) {
      await redis.decrby(`credits:${userId}`, 1);
    } else {
      const today = new Date().toISOString().slice(0, 10);
      const key = `usage:${userId}:${today}`;
      const used = Number((await redis.get(key)) ?? 0);
      if (used >= FREE_LIMIT) {
        return res.status(429).json({ error: "limit_reached", used, limit: FREE_LIMIT });
      }
      await redis.incr(key);
      await redis.expire(key, 86400);
    }
  }

  const prompt = buildPrompt(ticker, method, variables);
  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "web-search-2025-03-05",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 1000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await anthropicRes.json();
  if (!anthropicRes.ok) {
    return res.status(502).json({ error: "Upstream API error", detail: data });
  }

  const text = data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  console.log('Raw Anthropic response:', text);
  const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
  try {
    const json = JSON.parse(cleaned);
    return res.status(200).json(json);
  } catch (e) {
    console.error('Parse error:', e.message);
    console.error('Cleaned text was:', cleaned);
    return res.status(500).json({ error: 'Failed to parse valuation response' });
  }
}

export default handleRunValuation;
