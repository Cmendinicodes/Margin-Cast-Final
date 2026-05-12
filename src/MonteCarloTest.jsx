import { useState, useMemo, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Cell, LineChart, Line,
} from "recharts";

// ══════════════════════════════════════════════════════════════════════════════
// MATH UTILITIES
// ══════════════════════════════════════════════════════════════════════════════

function randn() {
  let u, v;
  do { u = Math.random(); } while (u === 0);
  do { v = Math.random(); } while (v === 0);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function normalCDF(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const p = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const cdf = 1 - (Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)) * p;
  return x >= 0 ? cdf : 1 - cdf;
}

function blackScholes(S, K, r, sigma, T, isCall) {
  if (T <= 0 || sigma <= 0) return isCall ? Math.max(S - K, 0) : Math.max(K - S, 0);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return isCall
    ? S * normalCDF(d1) - K * Math.exp(-r * T) * normalCDF(d2)
    : K * Math.exp(-r * T) * normalCDF(-d2) - S * normalCDF(-d1);
}

function pearsonCorr(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  return dx2 === 0 || dy2 === 0 ? 0 : num / Math.sqrt(dx2 * dy2);
}

function buildHistogram(data, nBins) {
  const sorted = [...data].sort((a, b) => a - b);
  const lo = sorted[0], hi = sorted[sorted.length - 1];
  const bw = Math.max((hi - lo) / nBins, 0.001);
  const bins = Array.from({ length: nBins }, (_, i) => ({
    idx: i, binLo: lo + i * bw, binHi: lo + (i + 1) * bw, count: 0,
  }));
  for (const v of sorted) bins[Math.min(Math.floor((v - lo) / bw), nBins - 1)].count++;
  return { bins, lo, bw, sorted };
}

const pct  = (sorted, p) => sorted[Math.min(Math.floor(sorted.length * p), sorted.length - 1)];
const avg  = arr => arr.reduce((s, v) => s + v, 0) / arr.length;
const sdev = arr => { const m = avg(arr); return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length); };
const skew = arr => { const m = avg(arr), s = sdev(arr); return s === 0 ? 0 : arr.reduce((a, v) => a + ((v - m) / s) ** 3, 0) / arr.length; };

// ══════════════════════════════════════════════════════════════════════════════
// SIMULATION ENGINES
// ══════════════════════════════════════════════════════════════════════════════

function runDCF({ baseFCF, growthMean, growthSd, waccMean, waccSd, termMean, termSd, years, nSims }) {
  const vals = [], gS = [], wS = [], tS = [];
  for (let i = 0; i < nSims; i++) {
    const g  = growthMean / 100 + (growthSd / 100) * randn();
    const w  = Math.max(waccMean / 100 + (waccSd / 100) * randn(), 0.04);
    const tg = Math.min(termMean / 100 + (termSd / 100) * randn(), w - 0.005);
    let fcf = baseFCF, pv = 0;
    for (let y = 1; y <= years; y++) { fcf *= (1 + g); pv += fcf / Math.pow(1 + w, y); }
    pv += (fcf * (1 + tg)) / (w - tg) / Math.pow(1 + w, years);
    vals.push(pv); gS.push(g); wS.push(w); tS.push(tg);
  }
  return {
    vals,
    sensitivity: [
      { name: "Growth Rate",   corr: pearsonCorr(gS, vals) },
      { name: "WACC",          corr: pearsonCorr(wS, vals) },
      { name: "Term. Growth",  corr: pearsonCorr(tS, vals) },
    ],
  };
}

const FAN_PATHS = 50, FAN_STEPS = 50;

function runOptions({ S0, K, r, volMean, volSd, T, isCall, nSims }) {
  const Ty = T / 365, rr = r / 100;
  const dt = Ty / FAN_STEPS;
  const paths = Array.from({ length: FAN_PATHS }, () => {
    const vol = Math.max(volMean / 100 + (volSd / 100) * randn(), 0.005);
    let S = S0;
    const path = [S0];
    for (let s = 0; s < FAN_STEPS; s++) {
      S *= Math.exp((rr - 0.5 * vol * vol) * dt + vol * Math.sqrt(dt) * randn());
      path.push(parseFloat(S.toFixed(2)));
    }
    return path;
  });
  const vals = [];
  for (let i = 0; i < nSims; i++) {
    const vol = Math.max(volMean / 100 + (volSd / 100) * randn(), 0.005);
    const ST  = S0 * Math.exp((rr - 0.5 * vol * vol) * Ty + vol * Math.sqrt(Ty) * randn());
    vals.push((isCall ? Math.max(ST - K, 0) : Math.max(K - ST, 0)) * Math.exp(-rr * Ty));
  }
  const itm = vals.filter(v => v > 0).length / nSims;
  return { vals, paths, itm, bsPrice: blackScholes(S0, K, rr, volMean / 100, Ty, isCall) };
}

function runPortfolio({ assets, avgCorr, portValue, timeDays, confLevel, nSims }) {
  const T = timeDays / 252;
  const totalW = assets.reduce((s, a) => s + a.weight, 0);
  const ws   = assets.map(a => a.weight / totalW);
  const mus  = assets.map(a => a.expectedReturn / 100);
  const sigs = assets.map(a => a.volatility / 100);
  const rho  = avgCorr;
  const sqRho = Math.sqrt(Math.max(rho, 0));
  const sqOneMinusRho = Math.sqrt(Math.max(1 - rho, 0));
  const pnls = [];
  for (let i = 0; i < nSims; i++) {
    const F = randn();
    let portRet = 0;
    for (let j = 0; j < assets.length; j++) {
      portRet += ws[j] * (mus[j] * T + sigs[j] * Math.sqrt(T) * (sqRho * F + sqOneMinusRho * randn()));
    }
    pnls.push(portRet * portValue);
  }
  const sortedPnL = [...pnls].sort((a, b) => a - b);
  const tail = Math.max(Math.floor((1 - confLevel) * nSims), 1);
  const varDollar = -sortedPnL[tail];
  const cvar      = -avg(sortedPnL.slice(0, tail));
  // Analytical variance contributions
  let portVar = 0;
  for (let i = 0; i < assets.length; i++)
    for (let j = 0; j < assets.length; j++)
      portVar += ws[i] * ws[j] * sigs[i] * sigs[j] * (i === j ? 1 : rho);
  const varContrib = assets.map((a, i) => {
    let covRow = ws[i] * sigs[i] * sigs[i];
    for (let j = 0; j < assets.length; j++) if (j !== i) covRow += ws[j] * sigs[j] * sigs[i] * rho;
    return { name: a.name || `A${i + 1}`, contrib: portVar === 0 ? 0 : (ws[i] * covRow / portVar) * 100 };
  });
  return { pnls, sortedPnL, varDollar, cvar, varContrib };
}

function runMA({ acquirerVal, targetVal, synMean, synSd, premium, integMean, integSd, closeProb, nSims }) {
  const premiumAmt = targetVal * premium / 100;
  const vals = [], synS = [], integS = [];
  for (let i = 0; i < nSims; i++) {
    if (Math.random() > closeProb / 100) { vals.push(0); continue; }
    const syn  = synMean  + synSd  * randn();
    const integ = Math.max(integMean + integSd * randn(), 0);
    vals.push(syn - integ - premiumAmt);
    synS.push(syn); integS.push(integ);
  }
  const medSyn   = synS.length  ? pct([...synS].sort((a,b)=>a-b), 0.5)   : synMean;
  const medInteg = integS.length ? pct([...integS].sort((a,b)=>a-b), 0.5) : integMean;
  const netNPV   = medSyn - medInteg - premiumAmt;
  const wfData   = [
    { name: "Synergies",   base: 0,                        bar: medSyn,   pos: true,        isNet: false },
    { name: "Integration", base: medSyn - medInteg,        bar: medInteg, pos: false,       isNet: false },
    { name: "Premium",     base: netNPV,                   bar: premiumAmt, pos: false,     isNet: false },
    { name: "Net NPV",     base: Math.min(0, netNPV),      bar: Math.abs(netNPV), pos: netNPV >= 0, isNet: true },
  ];
  return { vals, wfData, medSyn, medInteg, netNPV, breakEven: premiumAmt + integMean };
}

// ══════════════════════════════════════════════════════════════════════════════
// DESIGN TOKENS
// ══════════════════════════════════════════════════════════════════════════════

const C = {
  bg: "#0a0a0f", card: "#12121a", border: "#2a2830",
  gold: "#c9b96e", gold18: "#c9b96e18", gold40: "#c9b96e40", goldBB: "#c9b96ebb",
  text: "#f0ead6", sub: "#c8c0a8", muted: "#6b6458", faint: "#4a4640",
  green: "#22c55e", greenBB: "#22c55ebb", red: "#ef4444", redBB: "#ef4444bb",
};

// ══════════════════════════════════════════════════════════════════════════════
// SHARED UI PRIMITIVES
// ══════════════════════════════════════════════════════════════════════════════

function useDebounce(value, delay) {
  const [d, setD] = useState(value);
  useEffect(() => { const t = setTimeout(() => setD(value), delay); return () => clearTimeout(t); }, [value, delay]);
  return d;
}

function Label({ children }) {
  return <div style={{ fontSize: 11, letterSpacing: 4, color: C.gold, textTransform: "uppercase", marginBottom: 14 }}>{children}</div>;
}

function Card({ children, style }) {
  return <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 4, padding: 20, position: "relative", ...style }}>{children}</div>;
}

function SliderRow({ label, value, onChange, min, max, step, fmt }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <label style={{ fontSize: 12, color: C.sub }}>{label}</label>
        <span style={{ fontSize: 13, fontFamily: "monospace", color: C.gold, fontWeight: 700 }}>{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: C.gold, cursor: "pointer" }} />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.faint, marginTop: 2 }}>
        <span>{fmt(min)}</span><span>{fmt(max)}</span>
      </div>
    </div>
  );
}

function Toggles({ label, value, onChange, options }) {
  return (
    <div style={{ marginBottom: 16 }}>
      {label && <div style={{ fontSize: 12, color: C.sub, marginBottom: 5 }}>{label}</div>}
      <div style={{ display: "flex", gap: 4 }}>
        {options.map(o => (
          <button key={String(o.v)} onClick={() => onChange(o.v)} style={{
            flex: 1, padding: "6px 4px", fontSize: 12, fontFamily: "Georgia, serif",
            background: value === o.v ? C.gold : C.card, color: value === o.v ? C.bg : C.muted,
            border: `1px solid ${value === o.v ? C.gold : C.border}`, borderRadius: 3, cursor: "pointer",
            fontWeight: value === o.v ? 700 : 400,
          }}>{o.l}</button>
        ))}
      </div>
    </div>
  );
}

function Pill({ label, value, color, sm }) {
  return (
    <div style={{ flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: sm ? "10px 8px" : "14px 10px", textAlign: "center", minWidth: 80 }}>
      <div style={{ fontSize: 10, letterSpacing: 2, color: C.muted, textTransform: "uppercase", marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: sm ? 15 : 20, fontFamily: "monospace", fontWeight: 700, color: color || C.gold }}>{value}</div>
    </div>
  );
}

function Spinner() {
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(10,10,15,0.75)", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 4, zIndex: 10 }}>
      <span style={{ color: C.gold, fontSize: 11, letterSpacing: 3, textTransform: "uppercase" }}>Computing…</span>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SHARED HISTOGRAM CHART
// ══════════════════════════════════════════════════════════════════════════════

function HistChart({ bins, lo, bw, nSims, refLines = [], thresholdValue, invertBelow = false, height = 250, fmt }) {
  const f = fmt ?? (v => `$${Math.round(v)}`);
  const threshIdx = thresholdValue != null
    ? Math.min(Math.max(Math.floor((thresholdValue - lo) / bw), 0), bins.length - 1)
    : null;
  const cellColor = b => {
    if (threshIdx == null) return C.gold40;
    if (invertBelow) return b.idx < threshIdx ? C.redBB : C.gold40;
    return b.idx >= threshIdx ? C.greenBB : C.gold40;
  };
  const refIdxs = refLines.map(r => ({ ...r, idx: Math.min(Math.max(Math.floor((r.v - lo) / bw), 0), bins.length - 1) }));
  const interval = Math.max(Math.floor(bins.length / 7) - 1, 0);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={bins} margin={{ top: 4, right: 4, bottom: 4, left: 4 }} barCategoryGap={1}>
        <CartesianGrid vertical={false} stroke={C.border} />
        <XAxis dataKey="idx" tickFormatter={i => f(lo + i * bw)}
          tick={{ fill: C.muted, fontSize: 10, fontFamily: "monospace" }}
          tickLine={false} axisLine={{ stroke: C.border }} interval={interval} />
        <YAxis tick={{ fill: C.muted, fontSize: 10, fontFamily: "monospace" }}
          tickLine={false} axisLine={false} width={36} />
        <Tooltip cursor={{ fill: `${C.gold}12` }} content={({ active, payload }) => {
          if (!active || !payload?.length) return null;
          const { binLo, binHi, count } = payload[0].payload;
          return (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 4, padding: "10px 14px", fontSize: 12 }}>
              <div style={{ color: C.gold, fontFamily: "monospace", fontWeight: 700 }}>{f(binLo)} – {f(binHi)}</div>
              <div style={{ color: C.text, marginTop: 3 }}>{count.toLocaleString()} runs</div>
              <div style={{ color: C.muted, marginTop: 2 }}>{((count / nSims) * 100).toFixed(1)}%</div>
            </div>
          );
        }} />
        {refIdxs.map(r => (
          <ReferenceLine key={r.label} x={r.idx} stroke={r.color} strokeWidth={2} strokeDasharray="5 3"
            label={{ value: r.label, position: "insideTopRight", fill: r.color, fontSize: 10, fontFamily: "monospace" }} />
        ))}
        <Bar dataKey="count" radius={[2, 2, 0, 0]}>
          {bins.map(b => <Cell key={b.idx} fill={cellColor(b)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MODE 1 — DCF VALUATION
// ══════════════════════════════════════════════════════════════════════════════

function DCFMode() {
  const [baseFCF,    setBaseFCF]    = useState(8);
  const [growthMean, setGrowthMean] = useState(15);
  const [growthSd,   setGrowthSd]   = useState(5);
  const [waccMean,   setWaccMean]   = useState(10);
  const [waccSd,     setWaccSd]     = useState(2);
  const [termMean,   setTermMean]   = useState(3);
  const [termSd,     setTermSd]     = useState(1);
  const [years,      setYears]      = useState(7);
  const [curPrice,   setCurPrice]   = useState(150);
  const [nSims,      setNSims]      = useState(5000);

  const params = useMemo(() => ({ baseFCF, growthMean, growthSd, waccMean, waccSd, termMean, termSd, years, nSims }),
    [baseFCF, growthMean, growthSd, waccMean, waccSd, termMean, termSd, years, nSims]);
  const dp = useDebounce(params, 300);
  const pending = params !== dp;

  const { bins, lo, bw, stats, sensitivity } = useMemo(() => {
    const { vals, sensitivity } = runDCF(dp);
    const { bins, lo, bw, sorted } = buildHistogram(vals, 40);
    const m = avg(vals);
    return {
      bins, lo, bw, sensitivity,
      stats: {
        p5: pct(sorted,.05), p10: pct(sorted,.10), p25: pct(sorted,.25),
        p50: pct(sorted,.50), p75: pct(sorted,.75), p90: pct(sorted,.90), p95: pct(sorted,.95),
        mean: m, sd: sdev(vals), skew: skew(vals),
        probUnder: vals.filter(v => v > curPrice).length / dp.nSims,
        mos: ((pct(sorted,.50) - curPrice) / pct(sorted,.50)) * 100,
      },
    };
  }, [dp, curPrice]);

  const f$ = v => `$${v.toFixed(0)}`;
  const mos = stats.mos;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Card>
          <Label>DCF Inputs</Label>
          <SliderRow label="Base FCF / Share" value={baseFCF} onChange={setBaseFCF} min={1} max={30} step={0.5} fmt={v => `$${v.toFixed(1)}`} />
          <SliderRow label="Growth Rate μ"    value={growthMean} onChange={setGrowthMean} min={0}   max={40}  step={0.5} fmt={v => `${v}%`} />
          <SliderRow label="Growth Rate σ"    value={growthSd}   onChange={setGrowthSd}   min={0.5} max={15}  step={0.5} fmt={v => `${v}%`} />
          <SliderRow label="WACC μ"           value={waccMean}   onChange={setWaccMean}   min={5}   max={20}  step={0.5} fmt={v => `${v}%`} />
          <SliderRow label="WACC σ"           value={waccSd}     onChange={setWaccSd}     min={0.5} max={5}   step={0.5} fmt={v => `${v}%`} />
          <SliderRow label="Terminal Growth μ" value={termMean}  onChange={setTermMean}   min={0}   max={5}   step={0.5} fmt={v => `${v}%`} />
          <SliderRow label="Terminal Growth σ" value={termSd}    onChange={setTermSd}     min={0.5} max={3}   step={0.5} fmt={v => `${v}%`} />
          <SliderRow label="Horizon (years)"  value={years}      onChange={setYears}      min={5}   max={15}  step={1}   fmt={v => `${v} yr`} />
          <SliderRow label="Current Price"    value={curPrice}   onChange={setCurPrice}   min={10}  max={500} step={5}   fmt={v => `$${v}`} />
          <Toggles label="Simulations" value={nSims} onChange={setNSims}
            options={[{l:"1K",v:1000},{l:"5K",v:5000},{l:"10K",v:10000}]} />
        </Card>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Card>
          {pending && <Spinner />}
          <Label>Intrinsic Value Distribution</Label>
          <HistChart bins={bins} lo={lo} bw={bw} nSims={dp.nSims} thresholdValue={curPrice}
            refLines={[{ v: curPrice, label: `$${curPrice}`, color: C.red }, { v: stats.p50, label: "P50", color: C.gold }]} />
          <div style={{ display: "flex", gap: 16, fontSize: 11, color: C.muted, marginTop: 8 }}>
            <span><span style={{ color: C.green }}>■</span> Fair value &gt; current price</span>
            <span><span style={{ color: C.gold }}>■</span> Fair value ≤ current price</span>
          </div>
        </Card>

        <Card>
          <Label>Percentile Breakdown</Label>
          <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
            {[["P5",stats.p5],["P10",stats.p10],["P25",stats.p25],["P50",stats.p50],["P75",stats.p75],["P90",stats.p90],["P95",stats.p95]].map(([l,v]) =>
              <Pill key={l} label={l} value={f$(v)} sm />)}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Pill label="Mean"       value={f$(stats.mean)} sm />
            <Pill label="Std Dev"    value={f$(stats.sd)} sm />
            <Pill label="Skewness"   value={stats.skew.toFixed(2)} sm />
            <Pill label="Prob. Undervalued" value={`${(stats.probUnder*100).toFixed(1)}%`} color={stats.probUnder>=0.5?C.green:C.red} sm />
            <Pill label="MoS at P50" value={`${mos>=0?"+":""}${mos.toFixed(1)}%`} color={mos>0?C.green:C.red} sm />
          </div>
        </Card>

        <Card>
          <Label>Input Sensitivity — Pearson Correlation vs Fair Value</Label>
          <ResponsiveContainer width="100%" height={110}>
            <BarChart data={sensitivity} layout="vertical" margin={{ top: 0, right: 48, left: 90, bottom: 0 }}>
              <XAxis type="number" domain={[-1,1]} tick={{ fill: C.muted, fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis dataKey="name" type="category" tick={{ fill: C.sub, fontSize: 11, fontFamily: "Georgia, serif" }} axisLine={false} tickLine={false} width={88} />
              <Tooltip contentStyle={{ background: C.card, border: `1px solid ${C.border}`, fontSize: 11 }}
                formatter={v => [v.toFixed(3), "Correlation"]} />
              <ReferenceLine x={0} stroke={C.border} />
              <Bar dataKey="corr" radius={2}>
                {sensitivity.map(d => <Cell key={d.name} fill={d.corr >= 0 ? C.gold : C.red} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MODE 2 — OPTIONS PRICING
// ══════════════════════════════════════════════════════════════════════════════

function OptionsMode() {
  const [S0,      setS0]      = useState(150);
  const [K,       setK]       = useState(160);
  const [r,       setR]       = useState(5);
  const [volMean, setVolMean] = useState(25);
  const [volSd,   setVolSd]   = useState(5);
  const [T,       setT]       = useState(90);
  const [isCall,  setIsCall]  = useState(true);
  const [nSims,   setNSims]   = useState(5000);

  const params = useMemo(() => ({ S0, K, r, volMean, volSd, T, isCall, nSims }),
    [S0, K, r, volMean, volSd, T, isCall, nSims]);
  const dp = useDebounce(params, 300);
  const pending = params !== dp;

  const { bins, lo, bw, stats, paths, itm, bsPrice } = useMemo(() => {
    const { vals, paths, itm, bsPrice } = runOptions(dp);
    const { bins, lo, bw, sorted } = buildHistogram(vals, 40);
    return { bins, lo, bw, paths, itm, bsPrice,
      stats: { mean: avg(vals), p10: pct(sorted,.10), p50: pct(sorted,.50), p90: pct(sorted,.90) } };
  }, [dp]);

  const fanData = useMemo(() => Array.from({ length: FAN_STEPS + 1 }, (_, t) => {
    const obj = { t };
    paths.forEach((path, i) => { obj[`p${i}`] = path[t] ?? 0; });
    const col = paths.map(p => p[t] ?? 0).sort((a,b)=>a-b);
    obj.median = col[Math.floor(col.length / 2)] ?? 0;
    return obj;
  }), [paths]);

  const f$ = v => `$${v.toFixed(2)}`;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 14 }}>
      <Card>
        <Label>Options Inputs</Label>
        <SliderRow label="Stock Price (S₀)"  value={S0}      onChange={setS0}      min={10}  max={500} step={1}    fmt={v => `$${v}`} />
        <SliderRow label="Strike Price (K)"  value={K}       onChange={setK}       min={10}  max={500} step={1}    fmt={v => `$${v}`} />
        <SliderRow label="Risk-Free Rate"    value={r}       onChange={setR}       min={0}   max={10}  step={0.25} fmt={v => `${v}%`} />
        <SliderRow label="Implied Vol μ"     value={volMean} onChange={setVolMean} min={5}   max={100} step={1}    fmt={v => `${v}%`} />
        <SliderRow label="Implied Vol σ"     value={volSd}   onChange={setVolSd}   min={1}   max={20}  step={1}    fmt={v => `${v}%`} />
        <SliderRow label="Days to Expiry"    value={T}       onChange={setT}       min={7}   max={365} step={1}    fmt={v => `${v}d`} />
        <Toggles label="Option Type" value={isCall} onChange={setIsCall}
          options={[{l:"Call",v:true},{l:"Put",v:false}]} />
        <Toggles label="Simulations" value={nSims} onChange={setNSims}
          options={[{l:"1K",v:1000},{l:"5K",v:5000},{l:"10K",v:10000}]} />
      </Card>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Card>
          {pending && <Spinner />}
          <Label>Simulated Option Price Distribution</Label>
          <HistChart bins={bins} lo={lo} bw={bw} nSims={dp.nSims}
            refLines={[{ v: bsPrice, label: "B-S", color: C.gold }, { v: stats.p50, label: "P50", color: "#8888ff" }]}
            fmt={v => `$${v.toFixed(1)}`} />
        </Card>

        <Card>
          <Label>Summary</Label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Pill label="MC Mean"       value={f$(stats.mean)} />
            <Pill label="P10"           value={f$(stats.p10)} />
            <Pill label="P50"           value={f$(stats.p50)} color={C.text} />
            <Pill label="P90"           value={f$(stats.p90)} />
            <Pill label="Black-Scholes" value={f$(bsPrice)} color="#99aaff" />
            <Pill label="% In-the-Money" value={`${(itm*100).toFixed(1)}%`} color={itm>=0.5?C.green:C.red} />
          </div>
        </Card>

        <Card>
          <Label>Price Path Fan — 50 Simulated Paths</Label>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={fanData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="t" tick={{ fill: C.muted, fontSize: 10 }} tickLine={false}
                axisLine={{ stroke: C.border }} interval={9}
                tickFormatter={t => `D${Math.round(t * dp.T / FAN_STEPS)}`} />
              <YAxis tick={{ fill: C.muted, fontSize: 10, fontFamily: "monospace" }} tickLine={false}
                axisLine={false} width={48} tickFormatter={v => `$${v.toFixed(0)}`} />
              <ReferenceLine y={dp.K} stroke={C.red} strokeDasharray="4 3"
                label={{ value: `K=$${dp.K}`, position: "insideTopRight", fill: C.red, fontSize: 10 }} />
              {Array.from({ length: FAN_PATHS }, (_, i) => (
                <Line key={i} type="monotone" dataKey={`p${i}`} stroke={`${C.gold}20`}
                  dot={false} strokeWidth={1} isAnimationActive={false} />
              ))}
              <Line type="monotone" dataKey="median" stroke={C.gold} dot={false} strokeWidth={2.5} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>
            <span style={{ color: C.gold }}>—</span> Median path &nbsp;
            <span style={{ color: C.red }}>– –</span> Strike price
          </div>
        </Card>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MODE 3 — PORTFOLIO RISK / VaR
// ══════════════════════════════════════════════════════════════════════════════

const DEFAULT_ASSETS = [
  { name: "US Equity",  weight: 40, expectedReturn: 9,  volatility: 18 },
  { name: "Bonds",      weight: 25, expectedReturn: 4,  volatility: 6  },
  { name: "Real Estate",weight: 20, expectedReturn: 7,  volatility: 12 },
  { name: "Intl Equity",weight: 10, expectedReturn: 8,  volatility: 20 },
  { name: "Alts",       weight: 5,  expectedReturn: 10, volatility: 22 },
];

function PortfolioMode() {
  const [assets,    setAssets]    = useState(DEFAULT_ASSETS);
  const [avgCorr,   setAvgCorr]   = useState(0.30);
  const [portValue, setPortValue] = useState(1000000);
  const [timeDays,  setTimeDays]  = useState(1);
  const [confLevel, setConfLevel] = useState(0.95);
  const [nSims,     setNSims]     = useState(5000);

  const upd = (i, field, val) =>
    setAssets(prev => prev.map((a, j) => j === i ? { ...a, [field]: val } : a));

  const params = useMemo(() => ({ assets, avgCorr, portValue, timeDays, confLevel, nSims }),
    [assets, avgCorr, portValue, timeDays, confLevel, nSims]);
  const dp = useDebounce(params, 300);
  const pending = params !== dp;

  const { bins, lo, bw, varDollar, cvar, varContrib, sortedPnL } = useMemo(() => {
    const { pnls, sortedPnL, varDollar, cvar, varContrib } = runPortfolio(dp);
    const { bins, lo, bw } = buildHistogram(pnls, 40);
    return { bins, lo, bw, varDollar, cvar, varContrib, sortedPnL };
  }, [dp]);

  const totalW = assets.reduce((s, a) => s + a.weight, 0);
  const portMean = avg(sortedPnL);
  const portSd   = sdev(sortedPnL);
  const confLabel = `${Math.round(dp.confLevel * 100)}%`;
  const fPnL = v => v >= 0 ? `+$${(v/1000).toFixed(1)}K` : `-$${(-v/1000).toFixed(1)}K`;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "290px 1fr", gap: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Card>
          <Label>Portfolio Assets</Label>
          {assets.map((a, i) => (
            <div key={i} style={{ marginBottom: 18, paddingBottom: 18, borderBottom: i < assets.length - 1 ? `1px solid ${C.border}` : "none" }}>
              <input value={a.name} onChange={e => upd(i, "name", e.target.value)}
                style={{ background: "transparent", border: "none", borderBottom: `1px solid ${C.border}`, color: C.gold,
                  fontFamily: "monospace", fontSize: 13, fontWeight: 700, width: "100%", marginBottom: 10,
                  padding: "2px 0", outline: "none" }} />
              <SliderRow label="Weight" value={a.weight} onChange={v => upd(i, "weight", v)} min={1} max={100} step={1}
                fmt={v => `${Math.round((v / totalW) * 100)}%`} />
              <SliderRow label="Exp. Return" value={a.expectedReturn} onChange={v => upd(i, "expectedReturn", v)} min={-10} max={30} step={0.5} fmt={v => `${v}%`} />
              <SliderRow label="Volatility" value={a.volatility} onChange={v => upd(i, "volatility", v)} min={1} max={60} step={0.5} fmt={v => `${v}%`} />
            </div>
          ))}
        </Card>

        <Card>
          <Label>Simulation Settings</Label>
          <SliderRow label="Avg Correlation" value={avgCorr} onChange={setAvgCorr} min={0} max={0.95} step={0.05} fmt={v => v.toFixed(2)} />
          <SliderRow label="Portfolio Value" value={portValue} onChange={setPortValue} min={10000} max={10000000} step={10000}
            fmt={v => `$${(v/1000).toFixed(0)}K`} />
          <Toggles label="Time Horizon" value={timeDays} onChange={setTimeDays}
            options={[{l:"1d",v:1},{l:"5d",v:5},{l:"10d",v:10},{l:"21d",v:21}]} />
          <Toggles label="Confidence Level" value={confLevel} onChange={setConfLevel}
            options={[{l:"90%",v:0.90},{l:"95%",v:0.95},{l:"99%",v:0.99}]} />
          <Toggles label="Simulations" value={nSims} onChange={setNSims}
            options={[{l:"1K",v:1000},{l:"5K",v:5000},{l:"10K",v:10000}]} />
        </Card>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Card>
          {pending && <Spinner />}
          <Label>P&L Distribution — {dp.timeDays}-Day Horizon</Label>
          <HistChart bins={bins} lo={lo} bw={bw} nSims={dp.nSims}
            thresholdValue={-varDollar} invertBelow
            refLines={[{ v: -varDollar, label: `VaR ${confLabel}`, color: C.red }, { v: portMean, label: "Mean", color: C.gold }]}
            fmt={fPnL} />
          <div style={{ display: "flex", gap: 16, fontSize: 11, color: C.muted, marginTop: 8 }}>
            <span><span style={{ color: C.red }}>■</span> Beyond VaR threshold</span>
            <span><span style={{ color: C.gold }}>■</span> Within tolerance</span>
          </div>
        </Card>

        <Card>
          <Label>Risk Summary</Label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <Pill label={`VaR (${confLabel})`} value={`$${varDollar.toLocaleString(undefined,{maximumFractionDigits:0})}`} color={C.red} />
            <Pill label="CVaR (ES)"            value={`$${cvar.toLocaleString(undefined,{maximumFractionDigits:0})}`} color={C.red} />
            <Pill label="Mean P&L"             value={fPnL(portMean)} color={portMean>=0?C.green:C.red} />
            <Pill label="Std Dev"              value={`$${portSd.toFixed(0)}`} />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Pill label="Best Case"   value={fPnL(sortedPnL[sortedPnL.length-1])} color={C.green} />
            <Pill label="Worst Case"  value={fPnL(sortedPnL[0])} color={C.red} />
            <Pill label={`VaR % (${confLabel})`} value={`${((varDollar/dp.portValue)*100).toFixed(2)}%`} color={C.red} />
            <Pill label="CVaR %"      value={`${((cvar/dp.portValue)*100).toFixed(2)}%`} color={C.red} />
          </div>
        </Card>

        <Card>
          <Label>Variance Contribution by Asset</Label>
          <ResponsiveContainer width="100%" height={130}>
            <BarChart data={varContrib} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid vertical={false} stroke={C.border} />
              <XAxis dataKey="name" tick={{ fill: C.muted, fontSize: 10 }} tickLine={false} axisLine={{ stroke: C.border }} />
              <YAxis tick={{ fill: C.muted, fontSize: 10 }} tickLine={false} axisLine={false} width={34} tickFormatter={v => `${v.toFixed(0)}%`} />
              <Tooltip contentStyle={{ background: C.card, border: `1px solid ${C.border}`, fontSize: 11 }}
                formatter={v => [`${v.toFixed(1)}%`, "Variance Contribution"]} />
              <Bar dataKey="contrib" fill={C.gold} radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MODE 4 — M&A SYNERGY
// ══════════════════════════════════════════════════════════════════════════════

function MAMode() {
  const [acquirerVal, setAcquirerVal] = useState(500);
  const [targetVal,   setTargetVal]   = useState(200);
  const [synMean,     setSynMean]     = useState(60);
  const [synSd,       setSynSd]       = useState(20);
  const [premium,     setPremium]     = useState(30);
  const [integMean,   setIntegMean]   = useState(25);
  const [integSd,     setIntegSd]     = useState(10);
  const [closeProb,   setCloseProb]   = useState(80);
  const [nSims,       setNSims]       = useState(5000);

  const params = useMemo(() => ({ acquirerVal, targetVal, synMean, synSd, premium, integMean, integSd, closeProb, nSims }),
    [acquirerVal, targetVal, synMean, synSd, premium, integMean, integSd, closeProb, nSims]);
  const dp = useDebounce(params, 300);
  const pending = params !== dp;

  const { bins, lo, bw, wfData, stats } = useMemo(() => {
    const { vals, wfData, breakEven } = runMA(dp);
    const { bins, lo, bw, sorted } = buildHistogram(vals, 40);
    return {
      bins, lo, bw, wfData,
      stats: {
        probAccretive: vals.filter(v => v > 0).length / vals.length,
        p10: pct(sorted,.10), p50: pct(sorted,.50), p90: pct(sorted,.90),
        ev:  avg(vals), breakEven,
      },
    };
  }, [dp]);

  const fM = v => `$${v.toFixed(0)}M`;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 14 }}>
      <Card>
        <Label>Deal Parameters ($M)</Label>
        <SliderRow label="Acquirer Standalone Value" value={acquirerVal} onChange={setAcquirerVal} min={50}  max={2000} step={10} fmt={v => `$${v}M`} />
        <SliderRow label="Target Standalone Value"   value={targetVal}   onChange={setTargetVal}   min={10}  max={1000} step={5}  fmt={v => `$${v}M`} />
        <SliderRow label="Synergy Mean"              value={synMean}     onChange={setSynMean}     min={0}   max={300}  step={5}  fmt={v => `$${v}M`} />
        <SliderRow label="Synergy Std Dev"           value={synSd}       onChange={setSynSd}       min={1}   max={100}  step={1}  fmt={v => `$${v}M`} />
        <SliderRow label="Deal Premium"              value={premium}     onChange={setPremium}     min={0}   max={60}   step={1}  fmt={v => `${v}%`} />
        <SliderRow label="Integration Cost Mean"     value={integMean}   onChange={setIntegMean}   min={0}   max={200}  step={5}  fmt={v => `$${v}M`} />
        <SliderRow label="Integration Cost σ"        value={integSd}     onChange={setIntegSd}     min={1}   max={80}   step={1}  fmt={v => `$${v}M`} />
        <SliderRow label="Deal Close Probability"    value={closeProb}   onChange={setCloseProb}   min={10}  max={100}  step={1}  fmt={v => `${v}%`} />
        <Toggles label="Simulations" value={nSims} onChange={setNSims}
          options={[{l:"1K",v:1000},{l:"5K",v:5000},{l:"10K",v:10000}]} />
      </Card>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Card>
          {pending && <Spinner />}
          <Label>Acquirer Value Creation Distribution ($M)</Label>
          <HistChart bins={bins} lo={lo} bw={bw} nSims={dp.nSims} thresholdValue={0}
            refLines={[{ v: 0, label: "Break-even", color: C.red }, { v: stats.p50, label: "P50", color: C.gold }]}
            fmt={fM} />
          <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>
            Green = deal is value-accretive (NPV &gt; 0). Spike at $0M = deal falls through ({100 - dp.closeProb}% of runs).
          </div>
        </Card>

        <Card>
          <Label>Deal Summary</Label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <Pill label="Prob. Accretive" value={`${(stats.probAccretive*100).toFixed(1)}%`} color={stats.probAccretive>=0.5?C.green:C.red} />
            <Pill label="Expected Value"  value={fM(stats.ev)} color={stats.ev>0?C.green:C.red} />
            <Pill label="P10 NPV"         value={fM(stats.p10)} />
            <Pill label="P50 NPV"         value={fM(stats.p50)} color={C.text} />
            <Pill label="P90 NPV"         value={fM(stats.p90)} />
          </div>
          <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: "10px 14px", fontSize: 13 }}>
            <span style={{ color: C.muted }}>Break-even synergy required: </span>
            <span style={{ color: C.gold, fontFamily: "monospace", fontWeight: 700 }}>${Math.max(stats.breakEven, 0).toFixed(0)}M</span>
            <span style={{ color: C.muted }}> &nbsp;(premium + expected integration costs)</span>
          </div>
        </Card>

        <Card>
          <Label>Value Waterfall — Median Scenario ($M)</Label>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={wfData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid vertical={false} stroke={C.border} />
              <XAxis dataKey="name" tick={{ fill: C.muted, fontSize: 10 }} tickLine={false} axisLine={{ stroke: C.border }} />
              <YAxis tick={{ fill: C.muted, fontSize: 10, fontFamily: "monospace" }} tickLine={false} axisLine={false}
                width={52} tickFormatter={v => `$${Math.round(v)}M`} />
              <Tooltip contentStyle={{ background: C.card, border: `1px solid ${C.border}`, fontSize: 11 }}
                formatter={(_, __, props) => {
                  const d = props.payload;
                  const sign = d.pos ? "+" : "–";
                  return [`${sign}$${d.bar.toFixed(0)}M`, d.name];
                }} />
              <Bar dataKey="base" stackId="w" fill="transparent" legendType="none" />
              <Bar dataKey="bar"  stackId="w" radius={[2,2,0,0]}>
                {wfData.map(d => (
                  <Cell key={d.name} fill={d.isNet ? C.goldBB : (d.pos ? C.greenBB : C.redBB)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ROOT
// ══════════════════════════════════════════════════════════════════════════════

const TABS = [
  { id: "dcf",       label: "DCF Valuation"       },
  { id: "options",   label: "Options Pricing"      },
  { id: "portfolio", label: "Portfolio Risk / VaR" },
  { id: "ma",        label: "M&A Synergy"          },
];

export default function MonteCarloTest() {
  const [tab, setTab] = useState("dcf");
  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "Georgia, serif", color: C.text, padding: "32px 24px" }}>
      <div style={{ maxWidth: 1140, margin: "0 auto" }}>

        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "inline-block", background: C.gold18, border: `1px solid ${C.gold}50`,
            borderRadius: 3, padding: "4px 14px", fontSize: 11, color: C.gold,
            letterSpacing: 4, textTransform: "uppercase", marginBottom: 12 }}>Monte Carlo</div>
          <h1 style={{ fontSize: 22, fontWeight: 400, margin: "0 0 6px", color: C.text }}>Financial Research Suite</h1>
          <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.7, margin: 0 }}>
            Four simulation models · Box-Muller normal sampling · 300ms debounce · live re-simulation on slider change
          </p>
        </div>

        <div style={{ display: "flex", gap: 4, marginBottom: 20, flexWrap: "wrap" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: "8px 20px", fontSize: 13, fontFamily: "Georgia, serif",
              background: tab === t.id ? C.gold18 : "transparent",
              color: tab === t.id ? C.gold : C.muted,
              border: `1px solid ${tab === t.id ? C.gold + "50" : C.border}`,
              borderRadius: 3, cursor: "pointer", transition: "all 0.15s", letterSpacing: 0.3,
            }}>{t.label}</button>
          ))}
        </div>

        {tab === "dcf"       && <DCFMode />}
        {tab === "options"   && <OptionsMode />}
        {tab === "portfolio" && <PortfolioMode />}
        {tab === "ma"        && <MAMode />}
      </div>
    </div>
  );
}
