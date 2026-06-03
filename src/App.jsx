import { useState, useCallback, useEffect } from "react";
import MonteCarloTest from "./MonteCarloTest";
import ToSGate from "./ToSGate";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  useAuth, useUser,
  SignInButton, SignedIn, SignedOut, UserButton,
} from "@clerk/clerk-react";

// ─────────────────────────────────────────────────────────────────────────────
// VALUATION CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const VALUATION_METHODS = [
  {
    id: "dcf", name: "DCF", full: "Discounted Cash Flow", icon: "📈",
    desc: "Intrinsic value based on future cash flows",
    variables: [
      { key: "growthRate",     label: "Revenue Growth Rate (%)",  default: 10, min: -20, max: 50,  step: 0.5 },
      { key: "discountRate",   label: "Discount Rate / WACC (%)", default: 10, min: 5,   max: 20,  step: 0.5 },
      { key: "terminalGrowth", label: "Terminal Growth Rate (%)", default: 3,  min: 0,   max: 5,   step: 0.5 },
      { key: "years",          label: "Projection Years",         default: 5,  min: 3,   max: 10,  step: 1   },
    ],
  },
  {
    id: "pe", name: "P/E", full: "Price-to-Earnings", icon: "💰",
    desc: "Valuation relative to earnings per share",
    variables: [
      { key: "targetPE",  label: "Target P/E Multiple",    default: 20, min: 5,   max: 60, step: 1   },
      { key: "epsGrowth", label: "EPS Growth Rate (%)",    default: 10, min: -10, max: 40, step: 0.5 },
    ],
  },
  {
    id: "ev_ebitda", name: "EV/EBITDA", full: "Enterprise Value / EBITDA", icon: "🏢",
    desc: "Capital-structure neutral valuation",
    variables: [
      { key: "targetMultiple", label: "Target EV/EBITDA Multiple", default: 12, min: 4,   max: 30, step: 0.5 },
      { key: "ebitdaGrowth",   label: "EBITDA Growth Rate (%)",    default: 8,  min: -10, max: 40, step: 0.5 },
    ],
  },
  {
    id: "ps", name: "P/S", full: "Price-to-Sales", icon: "📊",
    desc: "Valuation relative to revenue — useful for growth companies",
    variables: [
      { key: "targetPS",      label: "Target P/S Multiple",       default: 5,  min: 0.5, max: 20, step: 0.25 },
      { key: "revenueGrowth", label: "Revenue Growth Rate (%)",   default: 15, min: -10, max: 60, step: 0.5  },
    ],
  },
  {
    id: "pb", name: "P/B", full: "Price-to-Book", icon: "📚",
    desc: "Value relative to net assets — common for financials",
    variables: [
      { key: "targetPB", label: "Target P/B Multiple",   default: 3,  min: 0.5, max: 15, step: 0.25 },
      { key: "roe",      label: "Return on Equity (%)",  default: 15, min: 1,   max: 50, step: 0.5  },
    ],
  },
  {
    id: "ddm", name: "DDM", full: "Dividend Discount Model", icon: "💵",
    desc: "Fair value based on expected dividends",
    variables: [
      { key: "dividendGrowth", label: "Dividend Growth Rate (%)",    default: 5,  min: 0, max: 15, step: 0.5 },
      { key: "requiredReturn", label: "Required Rate of Return (%)", default: 10, min: 5, max: 20, step: 0.5 },
    ],
  },
  {
    id: "graham", name: "Graham", full: "Graham Number", icon: "📐",
    desc: "Benjamin Graham's intrinsic value formula",
    variables: [
      { key: "peRatio", label: "Max Acceptable P/E", default: 15,  min: 5,   max: 25, step: 1   },
      { key: "pbRatio", label: "Max Acceptable P/B", default: 1.5, min: 0.5, max: 5,  step: 0.1 },
    ],
  },
  {
    id: "peg", name: "PEG", full: "Price/Earnings-to-Growth", icon: "⚡",
    desc: "P/E adjusted for earnings growth speed",
    variables: [
      { key: "fairPEG",        label: "Fair PEG Ratio",                 default: 1,  min: 0.5, max: 2,  step: 0.1 },
      { key: "growthForecast", label: "5-Year EPS Growth Forecast (%)", default: 15, min: 5,   max: 50, step: 1   },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// API CALL  (→ /api/run-valuation with Clerk token)
// ─────────────────────────────────────────────────────────────────────────────
async function callValuationAPI(ticker, method, variables, token) {
  const res = await fetch("/api/run-valuation", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ ticker, method, variables }),
  });

  if (res.status === 429) {
    const data = await res.json().catch(() => ({ used: 5, limit: 5 }));
    const err = new Error("limit_reached");
    err.limitData = data;
    throw err;
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Server error ${res.status}`);
  }

  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// MATRIX MATH  (normal equation: β = (XᵀX)⁻¹Xᵀy)
// ─────────────────────────────────────────────────────────────────────────────
function mT(A) {
  return A[0].map((_, j) => A.map((r) => r[j]));
}
function mM(A, B) {
  const rA = A.length, cA = A[0].length, cB = B[0].length;
  return Array.from({ length: rA }, (_, i) =>
    Array.from({ length: cB }, (_, j) =>
      Array.from({ length: cA }, (_, k) => A[i][k] * B[k][j]).reduce((s, v) => s + v, 0)
    )
  );
}
function mInv(M) {
  const n = M.length;
  const A = M.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => +(i === j))]);
  for (let c = 0; c < n; c++) {
    let mx = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[mx][c])) mx = r;
    [A[c], A[mx]] = [A[mx], A[c]];
    const piv = A[c][c];
    if (Math.abs(piv) < 1e-12) throw new Error("Singular matrix — insufficient price variation in data.");
    for (let j = 0; j < 2 * n; j++) A[c][j] /= piv;
    for (let r = 0; r < n; r++) {
      if (r !== c) {
        const f = A[r][c];
        for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[c][j];
      }
    }
  }
  return A.map((r) => r.slice(n));
}
function fitLR(X, y) {
  const Xt = mT(X);
  return mM(mInv(mM(Xt, X)), mM(Xt, y.map((v) => [v]))).map((b) => b[0]);
}
function predictLR(X, beta) {
  return X.map((row) => row.reduce((s, x, i) => s + x * beta[i], 0));
}

// ─────────────────────────────────────────────────────────────────────────────
// STATISTICS
// ─────────────────────────────────────────────────────────────────────────────
function computeMetrics(actual, pred) {
  const n    = actual.length;
  const mae  = actual.reduce((s, a, i) => s + Math.abs(a - pred[i]), 0) / n;
  const rmse = Math.sqrt(actual.reduce((s, a, i) => s + (a - pred[i]) ** 2, 0) / n);
  const mean = actual.reduce((s, v) => s + v, 0) / n;
  const ss   = actual.reduce((s, v) => s + (v - mean) ** 2, 0);
  const sr   = actual.reduce((s, v, i) => s + (v - pred[i]) ** 2, 0);
  return { mae, rmse, r2: 1 - sr / ss };
}

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE ENGINEERING
// ─────────────────────────────────────────────────────────────────────────────
function rMean(a, w) {
  return a.map((_, i) =>
    i < w - 1 ? null : a.slice(i - w + 1, i + 1).reduce((s, v) => s + v, 0) / w
  );
}
function rStd(a, w) {
  return a.map((_, i) => {
    if (i < w - 1) return null;
    const sl = a.slice(i - w + 1, i + 1);
    const m  = sl.reduce((s, v) => s + v, 0) / w;
    return Math.sqrt(sl.reduce((s, v) => s + (v - m) ** 2, 0) / w);
  });
}
function buildDataset(closes) {
  const ma5  = rMean(closes, 5);
  const ma10 = rMean(closes, 10);
  const ma20 = rMean(closes, 20);
  const ret1 = closes.map((c, i) => (i === 0 ? null : (c - closes[i - 1]) / closes[i - 1]));
  const ret5 = closes.map((c, i) => (i < 5    ? null : (c - closes[i - 5]) / closes[i - 5]));
  const vol  = rStd(ret1.map((r, i) => (i === 0 || r == null ? 0 : r)), 5);
  const rows = [];
  for (let i = 0; i < closes.length - 1; i++) {
    if ([ma5[i], ma10[i], ma20[i], ret1[i], ret5[i], vol[i]].some((v) => v == null)) continue;
    rows.push({
      X: [1, closes[i], ma5[i], ma10[i], ma20[i], ret1[i], ret5[i], vol[i]],
      y: closes[i + 1],
      idx: i + 1,
    });
  }
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// YAHOO FINANCE FETCH
// ─────────────────────────────────────────────────────────────────────────────
async function fetchPrices(ticker, token) {
  const res = await fetch("/api/run-quant", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ ticker }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to fetch price data for "${ticker}".`);
  }
  const prices = await res.json();
  const valid = prices.filter((p) => p.close != null && !isNaN(p.close));
  if (valid.length < 50) throw new Error(`Not enough price data returned for "${ticker}".`);
  return { dates: valid.map((p) => p.date), closes: valid.map((p) => p.close) };
}

// ─────────────────────────────────────────────────────────────────────────────
// PAYWALL MODAL
// ─────────────────────────────────────────────────────────────────────────────
function PaywallModal({ used, limit, onClose }) {
  const WHOP_URL = "https://whop.com/margin-cast/";

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(0,0,0,0.85)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20,
    }}>
      <div style={{
        background: "#12121a",
        border: "1px solid #c9b96e",
        borderRadius: 4,
        padding: 40,
        maxWidth: 420,
        width: "100%",
        fontFamily: "Georgia, serif",
      }}>
        <div style={{ fontSize: 11, letterSpacing: 4, color: "#c9b96e", textTransform: "uppercase", marginBottom: 12 }}>
          Daily Limit Reached
        </div>
        <h2 style={{ color: "#f0ead6", fontSize: 22, fontWeight: 400, margin: "0 0 8px" }}>
          You've used your {limit} free valuations today
        </h2>
        <p style={{ color: "#6b6458", fontSize: 14, margin: "0 0 28px", lineHeight: 1.6 }}>
          Get more valuations with a credit pack
        </p>

        <div style={{ marginBottom: 28 }}>
          {[
            "Credits never expire",
            "All 8 professional valuation methods",
            "Quant Prediction (coming soon)",
          ].map((b) => (
            <div key={b} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, color: "#c8c0a8", fontSize: 14 }}>
              <span style={{ color: "#c9b96e", fontSize: 16 }}>✓</span>
              {b}
            </div>
          ))}
        </div>

        <a
          href={WHOP_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "block", width: "100%", background: "#c9b96e",
            color: "#0a0a0f", border: "none", padding: "14px", fontSize: 15,
            cursor: "pointer", fontFamily: "Georgia, serif", fontWeight: 700,
            borderRadius: 4, letterSpacing: 1, marginBottom: 10,
            textAlign: "center", textDecoration: "none",
          }}
        >
          Starter Pack — 10 Credits →
        </a>

        <a
          href={WHOP_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "block", width: "100%", background: "transparent",
            color: "#c9b96e", border: "1px solid #c9b96e", padding: "14px", fontSize: 15,
            cursor: "pointer", fontFamily: "Georgia, serif", fontWeight: 700,
            borderRadius: 4, letterSpacing: 1, marginBottom: 12,
            textAlign: "center", textDecoration: "none",
          }}
        >
          Power Pack — 100 Credits →
        </a>

        <div style={{ textAlign: "center" }}>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", color: "#4a4640",
              fontSize: 13, cursor: "pointer", fontFamily: "Georgia, serif",
              textDecoration: "underline",
            }}
          >
            Maybe later
          </button>
        </div>

        <div style={{ marginTop: 20, textAlign: "center", fontSize: 12, color: "#4a4640" }}>
          {used} of {limit} free valuations used today
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// USAGE COUNTER  (header widget for free users)
// ─────────────────────────────────────────────────────────────────────────────
function UsageCounter({ refreshKey }) {
  const { getToken, isSignedIn } = useAuth();
  const { user } = useUser();
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    if (!isSignedIn) return;
    if (user?.publicMetadata?.plan === "pro") return;
    getToken().then((token) => {
      fetch("/api/usage", {
        headers: { "Authorization": `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((d) => setUsage(d))
        .catch(() => {});
    });
  }, [isSignedIn, user, getToken, refreshKey]);

  if (!isSignedIn || !usage) return null;
  if (user?.publicMetadata?.plan === "pro") return null;

  return (
    <span style={{ fontSize: 12, color: "#6b6458", fontFamily: "monospace" }}>
      {usage.used} / {usage.limit} free today
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGN-IN PROMPT  (shown when user tries to run without being signed in)
// ─────────────────────────────────────────────────────────────────────────────
function SignInPrompt({ onClose }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(0,0,0,0.85)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20,
    }}>
      <div style={{
        background: "#12121a", border: "1px solid #2a2830",
        borderRadius: 4, padding: 40, maxWidth: 380, width: "100%",
        fontFamily: "Georgia, serif", textAlign: "center",
      }}>
        <div style={{ fontSize: 11, letterSpacing: 4, color: "#c9b96e", textTransform: "uppercase", marginBottom: 12 }}>
          Sign In Required
        </div>
        <h2 style={{ color: "#f0ead6", fontSize: 20, fontWeight: 400, margin: "0 0 8px" }}>
          Create a free account to start
        </h2>
        <p style={{ color: "#6b6458", fontSize: 14, margin: "0 0 28px", lineHeight: 1.6 }}>
          Get 5 free valuations per day. No credit card required.
        </p>
        <SignInButton mode="modal">
          <button style={{
            width: "100%", background: "#c9b96e", color: "#0a0a0f",
            border: "none", padding: "16px", fontSize: 16,
            cursor: "pointer", fontFamily: "Georgia, serif",
            fontWeight: 700, borderRadius: 4, letterSpacing: 1, marginBottom: 12,
          }}>
            Sign In / Sign Up →
          </button>
        </SignInButton>
        <button
          onClick={onClose}
          style={{
            background: "none", border: "none", color: "#4a4640",
            fontSize: 13, cursor: "pointer", fontFamily: "Georgia, serif",
            textDecoration: "underline",
          }}
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUCCESS PAGE
// ─────────────────────────────────────────────────────────────────────────────
function SuccessPage() {
  return (
    <div style={{
      minHeight: "100vh", background: "#0a0a0f",
      fontFamily: "Georgia, serif", color: "#e8e4d9",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        background: "#12121a", border: "1px solid #c9b96e",
        borderRadius: 4, padding: 56, maxWidth: 440, width: "100%",
        textAlign: "center",
      }}>
        <div style={{
          display: "inline-block", background: "#c9b96e20",
          border: "1px solid #c9b96e50", borderRadius: 3,
          padding: "4px 14px", fontSize: 12, color: "#c9b96e",
          letterSpacing: 3, textTransform: "uppercase", marginBottom: 24,
        }}>
          PRO
        </div>
        <h1 style={{ color: "#f0ead6", fontSize: 26, fontWeight: 400, margin: "0 0 12px" }}>
          You're now on Margin-Cast Pro
        </h1>
        <p style={{ color: "#6b6458", fontSize: 14, lineHeight: 1.7, margin: "0 0 36px" }}>
          Unlimited valuations, every day. All 8 professional methods.
          Welcome to the full experience.
        </p>
        <button
          onClick={() => window.location.href = "/"}
          style={{
            background: "#c9b96e", color: "#0a0a0f",
            border: "none", padding: "16px 32px", fontSize: 16,
            cursor: "pointer", fontFamily: "Georgia, serif",
            fontWeight: 700, borderRadius: 4, letterSpacing: 1,
          }}
        >
          Start Valuing →
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VALUATION APP
// ─────────────────────────────────────────────────────────────────────────────
function StockValuationApp({ onPaywall, onValuationComplete }) {
  const { isSignedIn, getToken } = useAuth();

  const [ticker,         setTicker]         = useState("");
  const [inputVal,       setInputVal]       = useState("");
  const [selectedMethod, setSelectedMethod] = useState(null);
  const [variables,      setVariables]      = useState({});
  const [result,         setResult]         = useState(null);
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState(null);
  const [step,           setStep]           = useState("input");
  const [showSignIn,     setShowSignIn]     = useState(false);

  const handleTickerSubmit = () => {
    if (!inputVal.trim()) return;
    setTicker(inputVal.trim().toUpperCase());
    setStep("method");
    setResult(null);
    setSelectedMethod(null);
  };

  const handleMethodSelect = (method) => {
    setSelectedMethod(method);
    const defaults = {};
    method.variables.forEach((v) => (defaults[v.key] = v.default));
    setVariables(defaults);
    setStep("variables");
  };

  const handleRunValuation = useCallback(async () => {
    if (!isSignedIn) {
      setShowSignIn(true);
      return;
    }
    setLoading(true);
    setError(null);
    setStep("result");
    try {
      const token = await getToken();
      const res = await callValuationAPI(ticker, selectedMethod, variables, token);
      setResult(res);
      onValuationComplete();
    } catch (e) {
      if (e.message === "limit_reached") {
        setStep("variables");
        onPaywall(e.limitData?.used ?? 5, e.limitData?.limit ?? 5);
      } else {
        setError(e.message || "Failed to fetch valuation. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [ticker, selectedMethod, variables, isSignedIn, getToken, onPaywall, onValuationComplete]);

  const reset = () => {
    setStep("input");
    setInputVal("");
    setTicker("");
    setSelectedMethod(null);
    setResult(null);
    setError(null);
  };

  const verdictColor = (verdict) => {
    if (!verdict) return "#a0a0a0";
    if (verdict.includes("UNDER")) return "#22c55e";
    if (verdict.includes("OVER"))  return "#ef4444";
    return "#f59e0b";
  };

  const isPercent = (key) =>
    key.toLowerCase().includes("rate") ||
    key.toLowerCase().includes("growth") ||
    key.toLowerCase().includes("return") ||
    key.toLowerCase().includes("roe");

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "40px 20px 60px", position: "relative" }}>
      {showSignIn && <SignInPrompt onClose={() => setShowSignIn(false)} />}

      {/* Breadcrumb */}
      {step !== "input" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 28, fontSize: 13, color: "#6b6458" }}>
          <span style={{ color: "#c9b96e", cursor: "pointer" }} onClick={reset}>Search</span>
          {ticker && (
            <>
              <span>›</span>
              <span
                style={{ color: step === "method" ? "#f0ead6" : "#6b6458", cursor: step !== "method" ? "pointer" : "default" }}
                onClick={() => step !== "method" && setStep("method")}
              >{ticker}</span>
            </>
          )}
          {selectedMethod && (
            <>
              <span>›</span>
              <span
                style={{ color: step === "variables" ? "#f0ead6" : "#6b6458", cursor: step === "result" ? "pointer" : "default" }}
                onClick={() => step === "result" && setStep("variables")}
              >{selectedMethod.name}</span>
            </>
          )}
          {step === "result" && <><span>›</span><span style={{ color: "#f0ead6" }}>Result</span></>}
        </div>
      )}

      {/* STEP 1 — Ticker */}
      {step === "input" && (
        <div style={{ animation: "fadeIn 0.4s ease" }}>
          <div style={{ background: "#12121a", border: "1px solid #2a2830", borderRadius: 4, padding: "32px 28px", textAlign: "center" }}>
            <p style={{ color: "#8a8070", fontSize: 15, marginBottom: 28, lineHeight: 1.6 }}>
              Enter any stock ticker and get an instant valuation<br />using professional-grade methods.
            </p>
            <div style={{ display: "flex", gap: 0, maxWidth: 320, margin: "0 auto" }}>
              <input
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && handleTickerSubmit()}
                placeholder="AAPL, MSFT, TSLA..."
                style={{
                  flex: 1, background: "#0a0a0f", border: "1px solid #2a2830",
                  borderRight: "none", color: "#f0ead6", fontSize: 18,
                  padding: "14px 18px", fontFamily: "monospace", letterSpacing: 2,
                  outline: "none", borderRadius: "4px 0 0 4px",
                }}
              />
              <button
                onClick={handleTickerSubmit}
                style={{
                  background: "#c9b96e", color: "#0a0a0f", border: "none",
                  padding: "14px 22px", fontSize: 15, cursor: "pointer",
                  fontFamily: "Georgia, serif", fontWeight: 700,
                  borderRadius: "0 4px 4px 0", whiteSpace: "nowrap",
                }}
              >
                Analyze →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 2 — Method */}
      {step === "method" && (
        <div style={{ animation: "fadeIn 0.4s ease" }}>
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, letterSpacing: 4, color: "#c9b96e", textTransform: "uppercase", marginBottom: 6 }}>Step 1 of 2</div>
            <h2 style={{ fontSize: 22, fontWeight: 400, margin: 0, color: "#f0ead6" }}>Choose a Valuation Method</h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {VALUATION_METHODS.map((m) => (
              <button
                key={m.id}
                onClick={() => handleMethodSelect(m)}
                style={{
                  background: "#12121a", border: "1px solid #2a2830",
                  borderRadius: 4, padding: "18px 16px", textAlign: "left",
                  cursor: "pointer", transition: "all 0.2s", color: "#e8e4d9",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#c9b96e"; e.currentTarget.style.background = "#16161f"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#2a2830"; e.currentTarget.style.background = "#12121a"; }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <span style={{ fontSize: 20 }}>{m.icon}</span>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#c9b96e", fontFamily: "monospace" }}>{m.name}</div>
                    <div style={{ fontSize: 11, color: "#6b6458", letterSpacing: 0.5 }}>{m.full}</div>
                  </div>
                </div>
                <div style={{ fontSize: 13, color: "#8a8070", lineHeight: 1.4 }}>{m.desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* STEP 3 — Sliders */}
      {step === "variables" && selectedMethod && (
        <div style={{ animation: "fadeIn 0.4s ease" }}>
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, letterSpacing: 4, color: "#c9b96e", textTransform: "uppercase", marginBottom: 6 }}>Step 2 of 2</div>
            <h2 style={{ fontSize: 22, fontWeight: 400, margin: 0, color: "#f0ead6" }}>
              {selectedMethod.icon} Adjust Assumptions
            </h2>
            <p style={{ color: "#6b6458", fontSize: 14, marginTop: 6 }}>
              Defaults are reasonable estimates. Tweak to model different scenarios.
            </p>
          </div>
          <div style={{ background: "#12121a", border: "1px solid #2a2830", borderRadius: 4, padding: "24px 24px 28px" }}>
            {selectedMethod.variables.map((v) => (
              <div key={v.key} style={{ marginBottom: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <label style={{ fontSize: 14, color: "#c8c0a8" }}>{v.label}</label>
                  <span style={{ fontSize: 16, fontFamily: "monospace", color: "#c9b96e", fontWeight: 700 }}>
                    {variables[v.key] ?? v.default}
                    {isPercent(v.key) ? "%" : v.key === "years" ? " yrs" : "×"}
                  </span>
                </div>
                <input
                  type="range"
                  min={v.min} max={v.max} step={v.step}
                  value={variables[v.key] ?? v.default}
                  onChange={(e) => setVariables((prev) => ({ ...prev, [v.key]: parseFloat(e.target.value) }))}
                  style={{ width: "100%", accentColor: "#c9b96e", cursor: "pointer" }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#4a4640", marginTop: 3 }}>
                  <span>{v.min}{isPercent(v.key) ? "%" : ""}</span>
                  <span>{v.max}{isPercent(v.key) ? "%" : ""}</span>
                </div>
              </div>
            ))}
            <button
              onClick={handleRunValuation}
              style={{
                width: "100%", background: "#c9b96e", color: "#0a0a0f",
                border: "none", padding: "16px", fontSize: 16,
                cursor: "pointer", fontFamily: "Georgia, serif",
                fontWeight: 700, borderRadius: 4, marginTop: 4, letterSpacing: 1,
              }}
            >
              Run {selectedMethod.name} Valuation →
            </button>
          </div>
        </div>
      )}

      {/* STEP 4 — Result */}
      {step === "result" && (
        <div style={{ animation: "fadeIn 0.4s ease" }}>
          {loading && (
            <div style={{ background: "#12121a", border: "1px solid #2a2830", borderRadius: 4, padding: "48px", textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 16, animation: "spin 2s linear infinite", display: "inline-block" }}>⚙</div>
              <div style={{ color: "#c9b96e", fontSize: 14, letterSpacing: 3, textTransform: "uppercase" }}>
                Fetching live data & running {selectedMethod?.name} model...
              </div>
              <div style={{ color: "#4a4640", fontSize: 12, marginTop: 8 }}>This may take 10–20 seconds</div>
            </div>
          )}
          {error && (
            <div style={{ background: "#1a0a0a", border: "1px solid #4a1a1a", borderRadius: 4, padding: 24, color: "#ef4444", textAlign: "center" }}>
              {error}
              <br />
              <button onClick={() => setStep("variables")} style={{ marginTop: 16, background: "transparent", border: "1px solid #4a1a1a", color: "#ef4444", padding: "8px 20px", cursor: "pointer", borderRadius: 4 }}>
                ← Try Again
              </button>
            </div>
          )}
          {result && !loading && (
            <div>
              <div style={{
                background: "#12121a", border: "1px solid #2a2830",
                borderRadius: "4px 4px 0 0", padding: "20px 24px",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "#f0ead6", fontFamily: "monospace" }}>{result.ticker}</div>
                  <div style={{ fontSize: 14, color: "#8a8070", marginTop: 2 }}>{result.companyName}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "#6b6458", letterSpacing: 3, textTransform: "uppercase", marginBottom: 4 }}>{selectedMethod?.full}</div>
                  <div style={{
                    display: "inline-block", padding: "4px 14px",
                    background: verdictColor(result.verdict) + "20",
                    border: `1px solid ${verdictColor(result.verdict)}40`,
                    color: verdictColor(result.verdict), borderRadius: 2,
                    fontSize: 13, fontWeight: 700, letterSpacing: 1,
                  }}>
                    {result.verdict}
                  </div>
                </div>
              </div>

              <div style={{
                background: "#0e1a0e", border: "1px solid #1a3a1a",
                borderTop: "none", padding: "20px 24px",
                display: "flex", justifyContent: "space-around", alignItems: "center",
              }}>
                {[
                  { label: "Current Price",     value: `$${result.currentPrice?.toFixed(2)}`, color: "#e8e4d9" },
                  { label: "→",                 value: null },
                  { label: "Fair Value",         value: `$${result.fairValue?.toFixed(2)}`,   color: "#22c55e" },
                  { label: "→",                 value: null },
                  { label: "Upside / Downside",  value: result.updownside, color: verdictColor(result.verdict) },
                ].map((item, i) =>
                  item.value === null ? (
                    <div key={i} style={{ fontSize: 24, color: "#2a3a2a" }}>→</div>
                  ) : (
                    <div key={i} style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 11, color: "#6b6458", letterSpacing: 3, textTransform: "uppercase", marginBottom: 6 }}>{item.label}</div>
                      <div style={{ fontSize: 28, fontFamily: "monospace", color: item.color }}>{item.value}</div>
                    </div>
                  )
                )}
              </div>

              <div style={{
                background: "#12121a", border: "1px solid #2a2830", borderTop: "none", padding: "20px 24px",
                display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 16,
              }}>
                {result.keyMetrics?.map((m, i) => (
                  <div key={i} style={{ borderLeft: "2px solid #2a2830", paddingLeft: 12 }}>
                    <div style={{ fontSize: 11, color: "#6b6458", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>{m.label}</div>
                    <div style={{ fontSize: 16, fontFamily: "monospace", color: "#c9b96e" }}>{m.value}</div>
                  </div>
                ))}
              </div>

              <div style={{ background: "#12121a", border: "1px solid #2a2830", borderTop: "none", borderRadius: "0 0 4px 4px", padding: "20px 24px" }}>
                <div style={{ fontSize: 11, color: "#6b6458", letterSpacing: 3, textTransform: "uppercase", marginBottom: 10 }}>Analysis</div>
                <p style={{ color: "#c8c0a8", fontSize: 14, lineHeight: 1.7, margin: 0 }}>{result.summary}</p>
                {result.dataNote && (
                  <p style={{ color: "#4a4640", fontSize: 12, marginTop: 12, marginBottom: 0, fontStyle: "italic" }}>{result.dataNote}</p>
                )}
                <div style={{ marginTop: 16, padding: "10px 14px", background: "#0a0a14", border: "1px solid #1e1e2e", borderRadius: 3, fontSize: 12, color: "#4a4640" }}>
                  ⚠ This is for educational purposes only and not financial advice. Always do your own research.
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                <button onClick={() => setStep("variables")} style={{ flex: 1, background: "transparent", border: "1px solid #2a2830", color: "#8a8070", padding: "12px", cursor: "pointer", borderRadius: 4, fontSize: 14 }}>
                  ← Adjust Variables
                </button>
                <button onClick={() => setStep("method")} style={{ flex: 1, background: "transparent", border: "1px solid #2a2830", color: "#8a8070", padding: "12px", cursor: "pointer", borderRadius: 4, fontSize: 14 }}>
                  Try Another Method
                </button>
                <button onClick={reset} style={{ flex: 1, background: "#c9b96e", color: "#0a0a0f", border: "none", padding: "12px", cursor: "pointer", borderRadius: 4, fontSize: 14, fontWeight: 700 }}>
                  New Stock
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// QUANT PREDICTION
// ─────────────────────────────────────────────────────────────────────────────
function QuantPredictionApp() {
  const [inputVal, setInputVal] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [result,   setResult]   = useState(null);
  const { getToken } = useAuth();
  const runModel = useCallback(async () => {
    const sym = inputVal.trim().toUpperCase();
    if (!sym) return;
    setLoading(true); setError(""); setResult(null);
    try {
      const token = await getToken();
      const { dates, closes } = await fetchPrices(sym, token);
      if (closes.length < 40) throw new Error("Need at least 40 trading days of data.");

      const dataset = buildDataset(closes);
      if (dataset.length < 20) throw new Error("Not enough clean data points after feature engineering.");

      const split    = Math.floor(dataset.length * 0.8);
      const train    = dataset.slice(0, split);
      const test     = dataset.slice(split);
      const beta     = fitLR(train.map((r) => r.X), train.map((r) => r.y));
      const testPred = predictLR(test.map((r) => r.X), beta);
      const m        = computeMetrics(test.map((r) => r.y), testPred);

      const n     = closes.length - 1;
      const s5    = closes.slice(n - 4, n + 1);
      const s10   = closes.slice(n - 9, n + 1);
      const s20   = closes.slice(n - 19, n + 1);
      const r1    = (closes[n] - closes[n - 1]) / closes[n - 1];
      const r5    = (closes[n] - closes[n - 5]) / closes[n - 5];
      const rets  = s5.map((c, i, a) => (i === 0 ? 0 : (c - a[i - 1]) / a[i - 1]));
      const rm    = rets.reduce((s, v) => s + v, 0) / 5;
      const vol   = Math.sqrt(rets.reduce((s, v) => s + (v - rm) ** 2, 0) / 5);
      const nextX = [1, closes[n], s5.reduce((s, v) => s + v, 0) / 5, s10.reduce((s, v) => s + v, 0) / 10, s20.reduce((s, v) => s + v, 0) / 20, r1, r5, vol];
      const nextP = predictLR([nextX], beta)[0];
      const move  = ((nextP - closes[n]) / closes[n]) * 100;

      setResult({
        sym, metrics: m,
        lastClose: closes[n], nextPred: nextP, move,
        lastDate: dates[n], trainN: train.length, testN: test.length,
        chartData: test.map((row, i) => ({
          date:      dates[row.idx]?.slice(5) ?? `T+${i}`,
          Actual:    parseFloat(row.y.toFixed(2)),
          Predicted: parseFloat(testPred[i].toFixed(2)),
        })),
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [inputVal, getToken]);

  const r = result;

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "40px 20px 60px", position: "relative" }}>
      <div style={{ background: "#12121a", border: "1px solid #2a2830", borderRadius: 4, padding: "28px", marginBottom: 24 }}>
        <div style={{ fontSize: 11, letterSpacing: 4, color: "#c9b96e", textTransform: "uppercase", marginBottom: 10 }}>
          How it works
        </div>
        <p style={{ color: "#8a8070", fontSize: 14, lineHeight: 1.65, margin: "0 0 16px" }}>
          Pulls <strong style={{ color: "#c8c0a8" }}>2 years</strong> of daily closing prices from Yahoo Finance, engineers 7 features,
          trains a linear regression on the first <strong style={{ color: "#c8c0a8" }}>80%</strong> of data
          (time-ordered, no shuffle), evaluates on the remaining 20%, and predicts the next trading day's close.
          All computation runs in your browser — no server.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {["Close", "MA₅", "MA₁₀", "MA₂₀", "Return₁", "Return₅", "Volatility"].map((f) => (
            <span key={f} style={{
              fontSize: 12, fontFamily: "monospace", color: "#c9b96e",
              background: "#0a0a14", border: "1px solid #2a2830",
              borderRadius: 3, padding: "3px 10px",
            }}>{f}</span>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 0, marginBottom: 28 }}>
        <input
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && runModel()}
          placeholder="Ticker (e.g. AAPL)"
          style={{
            flex: 1, background: "#12121a", border: "1px solid #2a2830",
            borderRight: "none", color: "#f0ead6", fontSize: 18,
            padding: "14px 18px", fontFamily: "monospace", letterSpacing: 2,
            outline: "none", borderRadius: "4px 0 0 4px",
          }}
        />
        <button
          onClick={runModel}
          disabled={loading}
          style={{
            background: loading ? "#2a2830" : "#c9b96e",
            color: loading ? "#6b6458" : "#0a0a0f",
            border: "none", padding: "14px 22px", fontSize: 15,
            cursor: loading ? "not-allowed" : "pointer",
            fontFamily: "Georgia, serif", fontWeight: 700,
            borderRadius: "0 4px 4px 0", whiteSpace: "nowrap",
          }}
        >
          {loading ? "Computing..." : "Run Model →"}
        </button>
      </div>

      {loading && (
        <div style={{ background: "#12121a", border: "1px solid #2a2830", borderRadius: 4, padding: "48px", textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 16, animation: "spin 2s linear infinite", display: "inline-block" }}>⚙</div>
          <div style={{ color: "#c9b96e", fontSize: 14, letterSpacing: 3, textTransform: "uppercase" }}>
            Fetching price history & training model...
          </div>
          <div style={{ color: "#4a4640", fontSize: 12, marginTop: 8 }}>β = (XᵀX)⁻¹Xᵀy</div>
        </div>
      )}

      {error && (
        <div style={{ background: "#1a0a0a", border: "1px solid #4a1a1a", borderRadius: 4, padding: 24, color: "#ef4444", textAlign: "center", fontSize: 14 }}>
          {error}
        </div>
      )}

      {r && !loading && (
        <div style={{ animation: "fadeIn 0.4s ease" }}>
          <div style={{ fontSize: 11, letterSpacing: 4, color: "#c9b96e", textTransform: "uppercase", marginBottom: 10 }}>
            Model Performance — Test Set ({r.testN} days)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
            {[
              { label: "MAE",  value: `$${r.metrics.mae.toFixed(2)}`,  sub: "Mean Absolute Error" },
              { label: "RMSE", value: `$${r.metrics.rmse.toFixed(2)}`, sub: "Root Mean Sq. Error" },
              { label: "R²",   value: r.metrics.r2.toFixed(4),         sub: "R-Squared Score"     },
            ].map((m) => (
              <div key={m.label} style={{ background: "#12121a", border: "1px solid #2a2830", borderRadius: 4, padding: "16px", textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "#6b6458", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>{m.sub}</div>
                <div style={{ fontSize: 26, fontFamily: "monospace", color: "#c9b96e", fontWeight: 700 }}>{m.value}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 11, letterSpacing: 4, color: "#c9b96e", textTransform: "uppercase", marginBottom: 10 }}>
            Next-Day Prediction — {r.sym}
          </div>
          <div style={{
            background: "#12121a", border: "1px solid #c9b96e30",
            borderRadius: 4, padding: "20px 24px", marginBottom: 16,
            display: "flex", justifyContent: "space-around", alignItems: "center",
          }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#6b6458", letterSpacing: 3, textTransform: "uppercase", marginBottom: 6 }}>Last Close</div>
              <div style={{ fontSize: 28, fontFamily: "monospace", color: "#e8e4d9" }}>${r.lastClose.toFixed(2)}</div>
              <div style={{ fontSize: 11, color: "#4a4640", marginTop: 4 }}>{r.lastDate}</div>
            </div>
            <div style={{ fontSize: 24, color: "#2a2830" }}>→</div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#6b6458", letterSpacing: 3, textTransform: "uppercase", marginBottom: 6 }}>Predicted Close</div>
              <div style={{ fontSize: 28, fontFamily: "monospace", color: "#c9b96e", fontWeight: 700 }}>${r.nextPred.toFixed(2)}</div>
              <div style={{ fontSize: 11, color: "#4a4640", marginTop: 4 }}>Next Trading Day</div>
            </div>
            <div style={{ fontSize: 24, color: "#2a2830" }}>→</div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#6b6458", letterSpacing: 3, textTransform: "uppercase", marginBottom: 6 }}>Expected Move</div>
              <div style={{ fontSize: 28, fontFamily: "monospace", color: r.move >= 0 ? "#22c55e" : "#ef4444", fontWeight: 700 }}>
                {r.move >= 0 ? "+" : ""}{r.move.toFixed(2)}%
              </div>
              <div style={{ fontSize: 11, color: "#4a4640", marginTop: 4 }}>from last close</div>
            </div>
          </div>

          <div style={{ fontSize: 11, letterSpacing: 4, color: "#c9b96e", textTransform: "uppercase", marginBottom: 10 }}>
            Actual vs Predicted — Test Period
          </div>
          <div style={{ background: "#12121a", border: "1px solid #2a2830", borderRadius: 4, padding: "20px 20px 12px" }}>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={r.chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2a" />
                <XAxis dataKey="date" tick={{ fill: "#4a4640", fontSize: 10, fontFamily: "monospace" }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: "#4a4640", fontSize: 10, fontFamily: "monospace" }} domain={["auto", "auto"]} tickFormatter={(v) => `$${v}`} width={58} />
                <Tooltip
                  contentStyle={{ background: "#12121a", border: "1px solid #2a2830", borderRadius: 4, fontSize: 12, fontFamily: "monospace" }}
                  labelStyle={{ color: "#6b6458" }}
                  formatter={(v) => [`$${v}`]}
                />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8, fontFamily: "Georgia, serif" }} />
                <Line type="monotone" dataKey="Actual"    stroke="#e8e4d9" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="Predicted" stroke="#c9b96e" strokeWidth={1.5} dot={false} strokeDasharray="5 3" />
              </LineChart>
            </ResponsiveContainer>
            <div style={{ fontSize: 11, color: "#4a4640", textAlign: "center", marginTop: 8 }}>
              Trained on {r.trainN} days · Features: Close, MA₅, MA₁₀, MA₂₀, Return₁, Return₅, Volatility · Normal equation: β = (XᵀX)⁻¹Xᵀy
            </div>
          </div>

          <div style={{ marginTop: 16, padding: "10px 14px", background: "#0a0a14", border: "1px solid #1e1e2e", borderRadius: 3, fontSize: 12, color: "#4a4640" }}>
            ⚠ Linear regression on price data has known limitations. This is for educational purposes only and not financial advice.
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT APP
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab,          setTab]          = useState("valuation");
  const [paywall,      setPaywall]      = useState(null); // { used, limit }
  const [usageRefresh, setUsageRefresh] = useState(0);
  const { user }                        = useUser();
  const isPro                           = user?.publicMetadata?.plan === "pro";

  // Success page
  if (window.location.pathname === "/success") return <ToSGate><SuccessPage /></ToSGate>;

  return (
    <ToSGate>
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0f",
      fontFamily: "'Georgia', serif",
      color: "#e8e4d9",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Grid texture */}
      <div style={{
        position: "fixed", inset: 0, opacity: 0.04, pointerEvents: "none",
        backgroundImage: "linear-gradient(#c9b96e 1px, transparent 1px), linear-gradient(90deg, #c9b96e 1px, transparent 1px)",
        backgroundSize: "40px 40px",
      }} />

      {/* Paywall modal */}
      {paywall && (
        <PaywallModal
          used={paywall.used}
          limit={paywall.limit}
          onClose={() => setPaywall(null)}
        />
      )}

      {/* Header */}
      <div style={{
        borderBottom: "1px solid #2a2830",
        padding: "0 28px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: 58,
        position: "sticky",
        top: 0,
        background: "#0a0a0f",
        zIndex: 10,
      }}>
        {/* Logo + tabs */}
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <span style={{ fontSize: 11, letterSpacing: 6, color: "#c9b96e", textTransform: "uppercase" }}>
            Margin-Cast
          </span>
          <nav style={{ display: "flex", gap: 2 }}>
            {[
              { id: "valuation",   label: "Valuation"        },
              { id: "quant",       label: "Quant Prediction"  },
              { id: "montecarlo",  label: "Monte Carlo"       },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  background: tab === t.id ? "rgba(201,185,110,0.10)" : "transparent",
                  border: `1px solid ${tab === t.id ? "#c9b96e40" : "transparent"}`,
                  color: tab === t.id ? "#c9b96e" : "#6b6458",
                  padding: "5px 16px", borderRadius: 3,
                  fontFamily: "Georgia, serif", fontSize: 13,
                  cursor: "pointer", transition: "all 0.15s", letterSpacing: 0.3,
                }}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Auth + usage */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <SignedIn>
            {isPro ? (
              <div style={{
                background: "#c9b96e20", border: "1px solid #c9b96e50",
                borderRadius: 3, padding: "3px 10px",
                fontSize: 11, color: "#c9b96e", letterSpacing: 3, textTransform: "uppercase",
              }}>
                PRO
              </div>
            ) : (
              tab !== "montecarlo" && <UsageCounter refreshKey={usageRefresh} />
            )}
            <UserButton />
          </SignedIn>
          <SignedOut>
            <SignInButton mode="modal">
              <button style={{
                background: "#c9b96e", color: "#0a0a0f",
                border: "none", padding: "7px 18px",
                borderRadius: 3, fontFamily: "Georgia, serif",
                fontSize: 13, fontWeight: 700, cursor: "pointer",
              }}>
                Sign In
              </button>
            </SignInButton>
          </SignedOut>
        </div>
      </div>

      {/* Page content */}
      <div style={{ position: "relative" }}>
        {tab === "valuation" && (
          <StockValuationApp
            onPaywall={(used, limit) => setPaywall({ used, limit })}
            onValuationComplete={() => setUsageRefresh((n) => n + 1)}
          />
        )}
        {tab === "quant"       && <QuantPredictionApp />}
        {tab === "montecarlo"  && <MonteCarloTest />}
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @keyframes spin   { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        input[type=range] { height: 4px; }
      `}</style>
    </div>
    </ToSGate>
  );
}
