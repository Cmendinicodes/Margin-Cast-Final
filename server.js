import express from "express";
import dotenv from "dotenv";
dotenv.config();

// Dynamic imports AFTER dotenv.config() so Redis/Clerk clients
// see the env vars when their modules initialize
const { handleRunValuation } = await import("./api/run-valuation.js");
const { handleRunQuant }     = await import("./api/run-quant.js");
const { handleUsage }        = await import("./api/usage.js");
const { default: handleWhopWebhook } = await import("./api/whop-webhook.js");

const app = express();
app.use(express.json({ limit: "2mb" }));

app.post("/api/whop-webhook",  handleWhopWebhook);
app.post("/api/run-valuation", handleRunValuation);
app.post("/api/run-quant",     handleRunQuant);
app.get("/api/usage",          handleUsage);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
