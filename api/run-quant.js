import { verifyToken } from "@clerk/backend";

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

export async function handleRunQuant(req, res) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    await getUserId(token);
  } catch (e) {
    return res.status(401).json({ error: "Invalid token", detail: e.message });
  }

  let body;
  try { body = await parseBody(req); }
  catch { return res.status(400).json({ error: "Invalid request body" }); }

  const { ticker } = body;
  if (!ticker) return res.status(400).json({ error: "Missing ticker" });

  const prompt = `Use web search to find the daily closing prices for the stock ticker ${ticker.toUpperCase()} for the past 2 years.

Respond ONLY with a JSON array (no markdown, no backticks, no explanation) in this exact format:
[{"date":"2023-01-02","close":150.23},{"date":"2023-01-03","close":148.50},...]

Rules:
- Sort chronologically, oldest first
- Dates must be in YYYY-MM-DD format
- Close values must be numbers, not strings
- Include every available trading day for the past 2 years`;

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
      max_tokens: 8000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await anthropicRes.json();
  if (!anthropicRes.ok) {
    return res.status(502).json({ error: "Upstream API error", detail: data });
  }

  const text = data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const arrayMatch = text.replace(/```json|```/g, "").trim().match(/\[[\s\S]*\]/);
  if (!arrayMatch) return res.status(502).json({ error: "Could not parse price data from response" });

  let prices;
  try { prices = JSON.parse(arrayMatch[0]); }
  catch { return res.status(502).json({ error: "Invalid JSON in price data response" }); }

  return res.status(200).json(prices);
}

export default handleRunQuant;
