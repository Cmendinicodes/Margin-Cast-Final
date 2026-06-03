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

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker.toUpperCase())}?interval=1d&range=2y`;
  const yahooRes = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  if (!yahooRes.ok) {
    return res.status(502).json({ error: `Yahoo Finance returned ${yahooRes.status} for "${ticker}"` });
  }

  const json = await yahooRes.json();
  const chart = json?.chart?.result?.[0];
  if (!chart) {
    return res.status(502).json({ error: `No data returned for "${ticker}"` });
  }

  const timestamps = chart.timestamp;
  const closes = chart.indicators?.quote?.[0]?.close;
  if (!timestamps || !closes) {
    return res.status(502).json({ error: `Missing price data for "${ticker}"` });
  }

  const prices = timestamps
    .map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      close: closes[i],
    }))
    .filter((p) => p.close != null && !isNaN(p.close));

  return res.status(200).json(prices);
}

export default handleRunQuant;
