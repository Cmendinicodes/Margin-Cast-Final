import express from "express";
import dotenv from "dotenv";
dotenv.config();

// Dynamic imports AFTER dotenv.config() so Stripe/Redis/Clerk clients
// see the env vars when their modules initialize
const { handleRunValuation }   = await import("./api/run-valuation.js");
const { handleCreateCheckout } = await import("./api/create-checkout.js");
const { handleWebhook }        = await import("./api/webhook.js");
const { handleUsage }          = await import("./api/usage.js");

const app = express();

// Webhook must receive raw body for Stripe signature verification
app.post("/api/webhook", express.raw({ type: "application/json" }), handleWebhook);

// JSON parsing for all other routes
app.use(express.json({ limit: "2mb" }));

app.post("/api/run-valuation",   handleRunValuation);
app.post("/api/create-checkout", handleCreateCheckout);
app.get("/api/usage",            handleUsage);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
