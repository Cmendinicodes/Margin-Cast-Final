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
  const isPercent = (key) =>
    key.toLowerCase().includes("rate") ||
    key.toLowerCase().includes("growth") ||
    key.toLowerCase().includes("return") ||
    key.toLowerCase().includes("roe");

  const varDesc = method.variables
    .map((v) => `${v.label}: ${variables[v.key] ?? v.default}${isPercent(v.key) ? "%" : "x"}`)
    .join(", ");

  return `You are a financial analyst. Use web search to find REAL, CURRENT financial data for the stock ticker: ${ticker.toUpperCase()}.

Search for: current stock price, EPS, revenue, EBITDA, book value per share, dividend per share, shares outstanding, net debt, free cash flow, and analyst estimates for ${ticker.toUpperCase()}.

Then perform a ${method.full} (${method.name}) valuation using these user-selected variables: ${varDesc}.

Respond ONLY with a JSON object (no markdown, no backticks) in this exact format:
{
  "companyName": "Full company name",
  "ticker": "${ticker.toUpperCase()}",
  "currentPrice": 123.45,
  "fairValue": 145.00,
  "updownside": "+17.2%",
  "verdict": "UNDERVALUED",
  "confidence": "Medium",
  "keyMetrics": [
    {"label": "Current Price", "value": "$123.45"},
    {"label": "Fair Value Estimate", "value": "$145.00"},
    {"label": "EPS (TTM)", "value": "$6.12"},
    {"label": "P/E Ratio", "value": "20.2x"}
  ],
  "summary": "2-3 sentence plain-English explanation of the valuation result, key drivers, and any important caveats.",
  "dataNote": "Brief note on data sources and freshness"
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
      model: "claude-sonnet-4-6",
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
  const jsonMatch = text.replace(/```json|```/g, "").trim().match(/\{[\s\S]*\}/);
  if (!jsonMatch) return res.status(502).json({ error: "Could not parse valuation response" });

  try {
    return res.status(200).json(JSON.parse(jsonMatch[0]));
  } catch {
    return res.status(502).json({ error: "Invalid JSON in valuation response", raw: text.slice(0, 500) });
  }
}

export default handleRunValuation;
