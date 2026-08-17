/* rail — chart + 280px notepad. Live spot. Live desk. */
(function () {
  "use strict";

  const SPOT_URL = "https://api.gold-api.com/price/XAU";
  const SPOT_MS = 20000;
  const DESK_MS = 3000;
  const TICK_KEY = "rail-xau-ticks-v1";
  const TICK_CAP = 2000;
  const TZ = "America/New_York";
  const ET = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const state = {
    events: [],
    book: null,
    d1: [],
    friClose: null,
    spot: null,
    spotAt: null,
    spotSrc: null,
    spotStale: false,
    eventsStale: false,
    bookStale: false,
    chart: null,
    candles: null,
    spark: null,
    lastLine: null,
    lines: [],
    ticks: [],
  };

  const $ = (id) => document.getElementById(id);
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function parseTs(ts) {
    if (!ts) return null;
    const d = new Date(ts);
    return isNaN(d) ? null : d;
  }
  function fmtET(ts) {
    const d = parseTs(ts);
    return d ? ET.format(d) : "—";
  }
  function px(n, d) {
    if (n == null || n === "" || Number.isNaN(Number(n))) return "—";
    return Number(n).toLocaleString("en-US", {
      minimumFractionDigits: d ?? 2, maximumFractionDigits: d ?? 2,
    });
  }
  function payload(e) { return (e && e.payload) || {}; }

  function d1Unix(dateStr) {
    const [y, m, d] = String(dateStr).split("-").map(Number);
    return Math.floor(Date.UTC(y, m - 1, d) / 1000);
  }

  function loadTicks() {
    try {
      const raw = JSON.parse(localStorage.getItem(TICK_KEY) || "[]");
      if (!Array.isArray(raw)) return [];
      return raw.filter((p) => p && typeof p.t === "number" && typeof p.p === "number");
    } catch (e) { return []; }
  }
  function saveTicks() {
    try { localStorage.setItem(TICK_KEY, JSON.stringify(state.ticks.slice(-TICK_CAP))); } catch (e) {}
  }

  function pickGap(obj) {
    if (!obj || typeof obj !== "object") return null;
    const high = obj.gap_high != null ? obj.gap_high : (obj.fvg_high != null ? obj.fvg_high : obj.high);
    const low = obj.gap_low != null ? obj.gap_low : (obj.fvg_low != null ? obj.fvg_low : obj.low);
    if (high == null && low == null) return null;
    const mid = obj.gap_mid != null ? obj.gap_mid : (obj.fvg_mid != null ? obj.fvg_mid : obj.mid);
    return { high, low, mid };
  }

  function collectFVG() {
    let best = null;
    for (const e of state.events) {
      const p = payload(e);
      const g = pickGap(p) || pickGap(p.fvg);
      if (!g) continue;
      if (g.mid == null && g.high != null && g.low != null) {
        g.mid = (Number(g.high) + Number(g.low)) / 2;
      }
      best = {
        high: g.high, low: g.low, mid: g.mid,
        late_chase: !!(p.late_chase || (p.fvg && p.fvg.late_chase)),
        role: (p.fvg && p.fvg.role) || p.role || "profit_area",
        fill: p.fill_state || (p.fvg && (p.fvg.fill_state || (p.fvg.unused ? "unused" : ""))),
      };
    }
    return best || {
      high: 4223.505, low: 4106.475, mid: 4164.99,
      late_chase: true, role: "profit_area", fill: "unused",
    };
  }

  function m30Box() {
    for (let i = state.events.length - 1; i >= 0; i--) {
      const p = payload(state.events[i]);
      const b = p.box || p.htf_box;
      if (b && b.distal != null && b.proximal != null) {
        return {
          distal: b.distal,
          proximal: b.proximal,
          mid: b.mid_50 != null ? b.mid_50 : b.mid,
        };
      }
      if (p.distal != null && p.proximal != null && (state.events[i].tf || "").toUpperCase() === "M30") {
        return { distal: p.distal, proximal: p.proximal, mid: p.mid_50 != null ? p.mid_50 : p.mid };
      }
    }
    return { distal: 4373, proximal: 4392, mid: 4382.5 };
  }

  function cardOf() {
    const ev = [...state.events].reverse().find((e) => {
      const a = (e.action || "").toLowerCase();
      const p = payload(e);
      return a === "card" || a === "watch" || p.status || p.card;
    });
    const p = payload(ev);
    return {
      status: (p.status || p.card || "WAIT").toString().toUpperCase(),
      reason: p.skip_reason || p.reason || p.refuse || "price above unused M30 · no 50% return",
    };
  }

  function ticket() {
    const b = state.book || {};
    const t = (b.open || []).find((x) => String(x.ticket) === "102034139") || (b.open || [])[0] || {};
    return {
      ticket: t.ticket || "102034139",
      lots: t.lots != null ? t.lots : 0.05,
      entry: t.entry != null ? t.entry : 4043.95,
      sl: t.sl != null ? t.sl : 4050,
      swap: Number(t.swap || 0),
      commission: Number(t.commission || 0),
    };
  }

  function liveFloat() {
    const t = ticket();
    const b = state.book || {};
    if (state.spot != null) {
      return (state.spot - Number(t.entry)) * Number(t.lots) * 100 + t.swap + t.commission;
    }
    return b.floating_pl != null ? Number(b.floating_pl) : null;
  }

  function oneLine(e) {
    const p = payload(e);
    const a = (e.action || "").toLowerCase();
    if (p.skip_reason) return (p.status || p.card || a || "").toString().toUpperCase() + " — " + p.skip_reason;
    if (p.reason && (a === "card" || a === "watch" || a === "scan")) {
      return [(p.status || p.card || "").toString().toUpperCase(), p.reason].filter(Boolean).join(" — ");
    }
    if (a === "scan") {
      return [p.last_d1_bar, p.c != null ? "C " + px(p.c) : "", p.status, p.note].filter(Boolean).join(" · ");
    }
    if (a === "box") {
      return [p.label || p.side || "box", p.distal != null ? px(p.distal) + "–" + px(p.proximal) : "", p.refuse || p.note]
        .filter(Boolean).join(" · ");
    }
    if (a === "runner") {
      return "ticket " + (p.ticket || "") + " " + (p.lots || "") + " @ " + px(p.open_price || p.entry) + " SL " + px(p.sl);
    }
    if (a === "find" || a === "send") {
      const g = pickGap(p) || pickGap(p.fvg);
      return ["FVG", g ? px(g.low) + "–" + px(g.high) : "", p.late_chase ? "late chase" : "", p.note]
        .filter(Boolean).join(" · ");
    }
    if (p.note) return p.note;
    if (p.reason) return p.reason;
    return ((e.agent || "") + " " + (e.action || "event")).trim();
  }

  function renderLast() {
    const el = $("last-px");
    const flag = $("last-flag");
    if (state.spot == null) {
      el.textContent = "—";
      el.className = "";
      flag.textContent = state.spotStale ? "STALE" : "…";
      flag.className = state.spotStale ? "stale" : "";
      return;
    }
    el.textContent = px(state.spot);
    el.className = "";
    if (state.friClose != null) {
      el.className = state.spot >= state.friClose ? "up" : "dn";
    }
    if (state.spotStale || state.spotSrc !== "gold-api") {
      flag.textContent = "STALE";
      flag.className = "stale";
    } else {
      flag.textContent = "LIVE";
      flag.className = "live";
    }
  }

  function renderRail() {
    const card = cardOf();
    $("card-status").textContent = card.status;
    $("card-reason").textContent = card.reason;
    $("ev-flag").hidden = !state.eventsStale;

    const t = ticket();
    $("tix-id").textContent = t.ticket;
    const mark = state.spot != null ? " · mark " + px(state.spot) : "";
    $("tix-line").textContent = t.lots + " · " + px(t.entry) + " · SL " + px(t.sl) + mark;
    $("tix-note").textContent = "do not touch";

    const flt = liveFloat();
    const b = state.book || {};
    const fltEl = $("flt-line");
    if (flt == null) {
      fltEl.textContent = "—";
      fltEl.className = "";
    } else {
      fltEl.textContent = (flt >= 0 ? "+" : "") + px(flt) + (state.spot != null && !state.spotStale ? " live" : " stmt");
      fltEl.className = flt >= 0 ? "up" : "dn";
    }
    $("bal-line").textContent = px(b.balance) + " bal";
    $("book-flag").hidden = !state.bookStale;

    const f = collectFVG();
    $("fvg-lines").innerHTML =
      `<div class="ln"><span>HIGH</span><span>${px(f.high)}</span></div>` +
      `<div class="ln"><span>MID</span><span>${px(f.mid)}</span></div>` +
      `<div class="ln"><span>LOW</span><span>${px(f.low)}</span></div>`;
    $("fvg-note").textContent = [
      (f.role || "profit_area").replace(/_/g, " ").toUpperCase(),
      f.late_chase ? "late chase" : "",
      f.fill ? String(f.fill).replace(/_/g, " ") : "",
    ].filter(Boolean).join(" · ");

    const evs = state.events.slice().sort((a, c) => {
      return (parseTs(c.ts)?.getTime() || 0) - (parseTs(a.ts)?.getTime() || 0);
    }).slice(0, 6);
    $("feed").innerHTML = evs.map((e) =>
      `<div class="ev"><span>${esc(fmtET(e.ts))}</span><span class="ag">${esc(e.agent || "")}</span>` +
      `<span class="one" title="${esc(oneLine(e))}">${esc(oneLine(e))}</span></div>`
    ).join("");
  }

  function applyPriceLines() {
    if (!state.candles) return;
    state.lines.forEach((l) => { try { state.candles.removePriceLine(l); } catch (e) {} });
    state.lines = [];
    const add = (price, color, title, style) => {
      if (price == null || Number.isNaN(Number(price))) return;
      state.lines.push(state.candles.createPriceLine({
        price: Number(price), color, lineWidth: 1, lineStyle: style == null ? 2 : style,
        axisLabelVisible: true, title,
      }));
    };
    const t = ticket();
    const box = m30Box();
    const f = collectFVG();
    add(t.entry, "#c8c4bc", "ENTRY " + Number(t.entry).toFixed(2), 0);
    add(t.sl, "#b08986", "SL " + Number(t.sl).toFixed(0), 0);
    add(box.distal, "#6e7a68", "M30 " + Number(box.distal).toFixed(0), 2);
    add(box.mid, "#6e7a68", "M30 " + Number(box.mid).toFixed(1), 2);
    add(box.proximal, "#6e7a68", "M30 " + Number(box.proximal).toFixed(0), 2);
    add(f.low, "#5a5854", "FVG " + Number(f.low).toFixed(0), 3);
    add(f.mid, "#5a5854", "FVG " + Number(f.mid).toFixed(0), 3);
    add(f.high, "#5a5854", "FVG " + Number(f.high).toFixed(0), 3);
    if (state.spot != null) {
      state.lastLine = state.candles.createPriceLine({
        price: Number(state.spot),
        color: "#c4a35a",
        lineWidth: 1,
        lineStyle: 0,
        axisLabelVisible: true,
        title: (state.spotStale ? "STALE " : "LIVE ") + Number(state.spot).toFixed(2),
      });
      state.lines.push(state.lastLine);
    } else {
      state.lastLine = null;
    }
  }

  function pushTick(price) {
    if (price == null || Number.isNaN(Number(price))) return;
    let t = Math.floor(Date.now() / 1000);
    const last = state.ticks[state.ticks.length - 1];
    if (last && t <= last.t) t = last.t + 1;
    state.ticks.push({ t, p: Number(price) });
    if (state.ticks.length > TICK_CAP) state.ticks = state.ticks.slice(-TICK_CAP);
    saveTicks();
    if (state.spark) {
      state.spark.setData(state.ticks.map((x) => ({ time: x.t, value: x.p })));
    }
  }

  function ensureChart() {
    if (state.chart) return;
    const el = $("chart");
    state.chart = LightweightCharts.createChart(el, {
      layout: { background: { color: "#111111" }, textColor: "#6a6660", fontFamily: "ui-monospace, Menlo, Consolas, monospace" },
      grid: { vertLines: { color: "#191919" }, horzLines: { color: "#191919" } },
      rightPriceScale: { borderColor: "#2a2a2a", entireTextOnly: true },
      timeScale: { borderColor: "#2a2a2a", timeVisible: true, secondsVisible: false },
      crosshair: {
        vertLine: { color: "#c4a35a55", width: 1, labelBackgroundColor: "#1a1a1a" },
        horzLine: { color: "#c4a35a55", width: 1, labelBackgroundColor: "#1a1a1a" },
      },
      width: el.clientWidth,
      height: el.clientHeight,
    });
    state.candles = state.chart.addCandlestickSeries({
      upColor: "#d0ccc4", downColor: "#3a3a38",
      borderUpColor: "#d0ccc4", borderDownColor: "#6a6864",
      wickUpColor: "#d0ccc4", wickDownColor: "#6a6864",
    });
    state.spark = state.chart.addLineSeries({
      color: "#c4a35a",
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: true,
    });
    if (state.d1.length) {
      state.candles.setData(state.d1.map((b) => ({
        time: d1Unix(b.time),
        open: b.open, high: b.high, low: b.low, close: b.close,
      })));
      state.friClose = state.d1[state.d1.length - 1].close;
    }
    state.ticks = loadTicks();
    if (state.ticks.length) {
      state.spark.setData(state.ticks.map((x) => ({ time: x.t, value: x.p })));
    }
    applyPriceLines();
    const ro = new ResizeObserver(() => {
      if (!state.chart) return;
      state.chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
  }

  async function loadJSON(url) {
    const r = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error(url + " " + r.status);
    return r.json();
  }

  async function pollDesk() {
    try {
      const evs = await loadJSON("events.json");
      if (Array.isArray(evs)) state.events = evs;
      state.eventsStale = false;
    } catch (e) {
      state.eventsStale = true;
    }
    try {
      state.book = await loadJSON("book.json");
      state.bookStale = false;
    } catch (e) {
      state.bookStale = true;
    }
    renderRail();
    if (state.candles) applyPriceLines();
  }

  async function pollSpot() {
    try {
      const j = await fetch(SPOT_URL, { cache: "no-store" }).then((r) => {
        if (!r.ok) throw new Error("spot " + r.status);
        return r.json();
      });
      const price = Number(j.price);
      if (Number.isNaN(price)) throw new Error("no price");
      state.spot = price;
      state.spotAt = j.updatedAt || new Date().toISOString();
      state.spotSrc = "gold-api";
      state.spotStale = false;
      pushTick(price);
    } catch (e) {
      const bid = state.book && (state.book.bid != null ? state.book.bid : state.book.ask);
      if (bid != null) {
        state.spot = Number(bid);
        state.spotAt = (state.book && state.book.mt4_asof) || null;
        state.spotSrc = "book";
        pushTick(state.spot);
      }
      state.spotStale = true;
    }
    renderLast();
    renderRail();
    if (state.candles) applyPriceLines();
  }

  async function boot() {
    state.ticks = loadTicks();
    try {
      const d1 = await loadJSON("d1.json");
      state.d1 = (d1 && d1.bars) || [];
    } catch (e) {
      state.d1 = [];
    }
    ensureChart();
    await pollDesk();
    await pollSpot();
    setInterval(pollDesk, DESK_MS);
    setInterval(pollSpot, SPOT_MS);
  }

  boot();
})();
