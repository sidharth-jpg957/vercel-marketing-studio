// Marketing Studio front end. No libraries: plain JavaScript.
// The AI tools call /api/ai (see api/ai.js). The budget planner runs entirely in the browser.

const CHANNELS = ["Instagram", "Facebook", "YouTube", "LinkedIn", "X (Twitter)", "Google Search ads", "Email", "WhatsApp",
  "Influencers / creators", "Events / on-ground", "SEO / blog", "PR / media", "Print / outdoor"];
const GOALS = ["Brand awareness", "Lead generation", "Sales / conversions", "App installs / sign-ups", "Event footfall", "Customer retention"];
const VOICE_NAMES = ["Playful", "Premium", "Professional", "Friendly", "Bold", "Youthful / Gen Z", "Inspirational"];
const ANGLES = ["Benefit-led", "Urgency", "Curiosity", "Social proof (placeholders)", "Humour", "Problem-solution", "Storytelling"];
const PLATFORMS = {
  "Google Search ad": { headlineMax: 30, bodyMax: 90, hint: "Headline max 30 characters, description max 90." },
  "Instagram caption": { headlineMax: null, bodyMax: 2200, hint: "Caption max 2,200 characters; only the first lines show before 'more'." },
  "LinkedIn post": { headlineMax: null, bodyMax: 3000, hint: "Post max 3,000 characters; the first lines show before 'see more'." },
  "Email subject + preview": { headlineMax: 60, bodyMax: null, hint: "Subject lines of about 60 characters or fewer are a common guideline, not a hard limit." },
  "Other / no limit": { headlineMax: null, bodyMax: null, hint: "" },
};
const CTA_WORDS = ["buy", "shop", "sign up", "register", "book", "call", "learn more", "get", "join", "download", "subscribe", "try",
  "order", "visit", "click", "start", "claim", "reserve", "apply", "contact", "dm us", "swipe"];
const CHART_COLORS = ["#ff2e88", "#ffd23f", "#46e0b0", "#6c86ff", "#ff7a3d", "#c58bff", "#9be564", "#ff9bd2"];

// ------------------------------------------------------------------ helpers
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ok = (n) => n !== null && n !== undefined && Number.isFinite(n);
const inr = (n) => (ok(n) ? "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(n)) : "n/a");
const fnum = (n, d = 0) => (ok(n) ? new Intl.NumberFormat("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n) : "n/a");
const toNum = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : "#");

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Tiny Markdown reader for the competitor summary (escapes first, so it is safe).
function md(text) {
  const lines = esc(text).split(/\r?\n/);
  let html = "", inList = false;
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  for (const raw of lines) {
    const line = raw.trim();
    const li = line.match(/^[-*•]\s+(.*)$/);
    if (li) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${inline(li[1])}</li>`; continue; }
    if (inList) { html += "</ul>"; inList = false; }
    if (!line) continue;
    const h = line.match(/^#{1,4}\s+(.*)$/) || line.match(/^\*\*([^*]+)\*\*:?$/);
    html += h ? `<h3>${inline(h[1])}</h3>` : `<p>${inline(line)}</p>`;
  }
  if (inList) html += "</ul>";
  return html;
}

function store(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
function load(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; } }

// ------------------------------------------------------------------ brand panel
let brand = load("ms-brand", {});
const brandDialog = $("#brand-dialog");
function paintBrandDot() { $("#brand-dot").classList.toggle("on", Object.values(brand).some((v) => String(v || "").trim())); }
$("#brand-open").addEventListener("click", () => {
  $("#b-name").value = brand.name || ""; $("#b-tone").value = brand.tone || "";
  $("#b-offer").value = brand.offer || ""; $("#b-audience").value = brand.audience || "";
  brandDialog.showModal();
});
$("#brand-cancel").addEventListener("click", () => brandDialog.close());
$("#brand-form").addEventListener("submit", () => {
  brand = { name: $("#b-name").value.trim(), tone: $("#b-tone").value.trim(), offer: $("#b-offer").value.trim(), audience: $("#b-audience").value.trim() };
  store("ms-brand", brand);
  paintBrandDot();
  buildVoiceOptions();
});
paintBrandDot();

// ------------------------------------------------------------------ server calls
async function callAI(tool, input) {
  let res;
  try {
    res = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, input, brand }) });
  } catch {
    throw new Error("Could not reach the server. Check your internet connection and try again.");
  }
  let json = null;
  try { json = await res.json(); } catch {}
  if (!res.ok || !json || !json.ok) throw new Error((json && json.error) || `The server returned an error (HTTP ${res.status}).`);
  return json.data;
}

// Runs a form: shows a loading line, disables the button, renders the result or an error.
function wireForm(form, out, loadingText, work) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("button[type=submit]", form);
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Working…";
    out.innerHTML = `<p class="loading">${esc(loadingText)}</p>`;
    try {
      await work(new FormData(form));
    } catch (err) {
      out.innerHTML = `<p class="msg error">${esc(err.message)}</p>`;
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });
}

// ------------------------------------------------------------------ navigation
const TOOLS = ["brief", "voice", "budget", "competitor", "lab"];
function showTool(id, scroll) {
  if (!TOOLS.includes(id)) id = "brief";
  document.body.dataset.tool = id;
  $$(".panel").forEach((p) => (p.hidden = p.id !== "panel-" + id));
  $$("[data-tool]").forEach((b) => { if (b.tagName === "BUTTON") b.setAttribute("aria-current", b.dataset.tool === id ? "true" : "false"); });
  if (location.hash !== "#" + id) history.replaceState(null, "", "#" + id);
  if (scroll) $("#workspace").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}
$$("button[data-tool]").forEach((b) => b.addEventListener("click", () => showTool(b.dataset.tool, true)));
window.addEventListener("hashchange", () => showTool(location.hash.slice(1), false));

// ------------------------------------------------------------------ shared UI builders
function chipGroup(el, items, checked, name) {
  el.innerHTML = items.map((c) => `<label><input type="checkbox" name="${name}" value="${esc(c)}" ${checked.includes(c) ? "checked" : ""}><span>${esc(c)}</span></label>`).join("");
}
function fillSelect(el, items) { el.innerHTML = items.map((c) => `<option>${esc(c)}</option>`).join(""); }

// ================================================================== 1. Campaign brief
fillSelect($("#brief-goal"), GOALS);
chipGroup($("#brief-channels"), CHANNELS, ["Instagram", "Google Search ads", "Email"], "channels");
const weeks = $("#brief-form input[name=weeks]");
weeks.addEventListener("input", () => ($("#weeks-out").textContent = `${weeks.value} week${weeks.value === "1" ? "" : "s"}`));

function normShares(vals) {
  const v = vals.map((x) => Math.max(Number(x) || 0, 0));
  const t = v.reduce((a, b) => a + b, 0);
  return t > 0 ? v.map((x) => (x / t) * 100) : v.map(() => 100 / (v.length || 1));
}
function donut(items) {
  let acc = 0;
  const stops = items.map((it, i) => { const a = acc; acc += it.share; return `${CHART_COLORS[i % CHART_COLORS.length]} ${a}% ${acc}%`; });
  const legend = items.map((it, i) => `<li><span class="swatch" style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></span>${esc(it.label)}: ${fnum(it.share, 1)}%</li>`).join("");
  return `<div class="donut-wrap"><div class="donut" role="img" aria-label="Budget split by channel" style="background:conic-gradient(${stops.join(",")})"></div><ul class="legend">${legend}</ul></div>`;
}
function briefMarkdown(b) {
  const o = [`# Campaign brief: ${b.title}`, "", "## Positioning", b.positioning, "", "## Key messages", ...b.key_messages.map((x) => `- ${x}`),
    "", "## Tagline options", ...b.taglines.map((x) => `- ${x}`), "", `## Channel plan (budget ${inr(b.budget)})`];
  b.channel_plan.forEach((c) => { o.push(`### ${c.channel}: ${c.share_pct}% (${inr((b.budget * c.share_pct) / 100)})`, c.role, ...c.content_ideas.map((x) => `- ${x}`)); });
  o.push("", "## Calendar");
  b.calendar.forEach((w) => o.push(`### ${w.period}: ${w.focus}`, ...w.actions.map((x) => `- ${x}`)));
  o.push("", "## KPIs", ...b.kpis.map((k) => `- ${k.kpi}: ${k.how_to_measure}`), "", "## Assumptions and risks to verify", ...b.assumptions_and_risks.map((x) => `- ${x}`), "", "_Generated with AI. Verify claims before use._");
  return o.join("\n");
}
function renderBrief(b) {
  const list = (a) => `<ul>${a.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
  let h = `<section><p class="positioning">${esc(b.positioning)}</p></section>`;
  h += `<section class="cols"><div><h3>Key messages</h3>${list(b.key_messages)}</div><div><h3>Tagline options</h3>${list(b.taglines)}</div></section>`;
  if (b.channel_plan.length) {
    h += `<section><h3>Channel plan</h3>${donut(b.channel_plan.map((c) => ({ label: c.channel, share: c.share_pct })))}
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Channel</th><th class="r">Share</th><th class="r">Budget</th><th>Role</th></tr></thead><tbody>
      ${b.channel_plan.map((c) => `<tr><td>${esc(c.channel)}</td><td class="r">${fnum(c.share_pct, 1)}%</td><td class="r">${inr((b.budget * c.share_pct) / 100)}</td><td>${esc(c.role)}</td></tr>`).join("")}
      </tbody></table></div>
      ${b.channel_plan.map((c) => `<details><summary>Content ideas: ${esc(c.channel)}</summary>${list(c.content_ideas)}</details>`).join("")}</section>`;
  }
  if (b.calendar.length) h += `<section><h3>Calendar</h3>${b.calendar.map((w) => `<details><summary>${esc(w.period)}: ${esc(w.focus)}</summary>${list(w.actions)}</details>`).join("")}</section>`;
  if (b.kpis.length) h += `<section><h3>KPIs to track</h3><div class="table-wrap"><table class="tbl"><thead><tr><th>KPI</th><th>How to measure</th></tr></thead><tbody>${b.kpis.map((k) => `<tr><td>${esc(k.kpi)}</td><td>${esc(k.how_to_measure)}</td></tr>`).join("")}</tbody></table></div></section>`;
  if (b.assumptions_and_risks.length) h += `<section><h3>Assumptions and risks to verify</h3>${list(b.assumptions_and_risks)}</section>`;
  h += `<section><button type="button" class="btn ghost" id="brief-dl">Download as Markdown</button></section>`;
  $("#brief-out").innerHTML = h;
  $("#brief-dl").addEventListener("click", () => download("campaign_brief.md", briefMarkdown(b), "text/markdown"));
}
wireForm($("#brief-form"), $("#brief-out"), "Writing your brief. This usually takes 10 to 30 seconds.", async (fd) => {
  const input = {
    product: (fd.get("product") || "").trim() || brand.offer || "",
    audience: (fd.get("audience") || "").trim() || brand.audience || "",
    goal: fd.get("goal"), budget: toNum(fd.get("budget"), 100000), weeks: toNum(fd.get("weeks"), 4),
    channels: fd.getAll("channels"), geography: fd.get("geography"), extra: fd.get("extra"),
  };
  renderBrief(await callAI("brief", input));
});

// ================================================================== 2. Brand voice
function buildVoiceOptions() {
  const keep = $("#voice-select").value;
  const opts = [];
  if ((brand.tone || "").trim()) opts.push(["__brand__", "Use the tone from Your brand"]);
  VOICE_NAMES.forEach((v) => opts.push([v, v]));
  opts.push(["__custom__", "Describe my own voice"]);
  $("#voice-select").innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
  if (opts.some(([v]) => v === keep)) $("#voice-select").value = keep;
  $("#custom-voice-wrap").hidden = $("#voice-select").value !== "__custom__";
}
$("#voice-select").addEventListener("change", () => ($("#custom-voice-wrap").hidden = $("#voice-select").value !== "__custom__"));
buildVoiceOptions();

function syllables(w) {
  w = w.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  let n = (w.match(/[aeiouy]+/g) || []).length;
  if (w.endsWith("e") && !w.endsWith("le") && n > 1) n -= 1;
  return Math.max(n, 1);
}
function textStats(text) {
  const words = text.match(/[A-Za-z0-9'’-]+/g) || [];
  const sents = text.split(/[.!?]+(?:\s|$)/).filter((s) => s.trim());
  const nSent = Math.max(sents.length, 1);
  const syl = words.reduce((a, w) => a + syllables(w), 0);
  const flesch = words.length ? 206.835 - 1.015 * (words.length / nSent) - 84.6 * (syl / words.length) : null;
  const low = text.toLowerCase();
  const cta = CTA_WORDS.some((c) => new RegExp("\\b" + c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(low));
  return [
    ["Words", words.length], ["Sentences", sents.length || (words.length ? 1 : 0)],
    ["Words per sentence", words.length ? (words.length / nSent).toFixed(1) : 0],
    ["Reading ease", flesch === null ? "n/a" : Math.round(flesch)],
    ["Exclamation marks", (text.match(/!/g) || []).length], ["Question marks", (text.match(/\?/g) || []).length],
    ["Emojis", (text.match(/[\u{1F300}-\u{1FAFF}☀-➿]/gu) || []).length], ["Hashtags", (text.match(/#\w+/g) || []).length],
    ["Call to action found", cta ? "Yes" : "No"], ["Characters", text.length],
  ];
}
wireForm($("#voice-form"), $("#voice-out"), "Reading your copy…", async (fd) => {
  const copy = (fd.get("copy") || "").trim();
  if (!copy) throw new Error("Paste some copy first.");
  const stats = `<section><h3>Measured on this page</h3><div class="metrics">${textStats(copy).map(([k, v]) => `<div class="metric"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join("")}</div>
    <p class="hint" style="margin-top:1rem">Reading ease of 60 to 70 is plain English; higher is easier. The call-to-action check is a simple keyword search.</p></section>`;
  $("#voice-out").innerHTML = stats + `<p class="loading">Asking the AI for its judgement…</p>`;
  const r = await callAI("voice", { copy, voice: fd.get("voice"), customVoice: fd.get("customVoice"), channel: fd.get("channel") });
  let h = stats + `<section><h3>AI judgement</h3><p class="hint">These scores are the AI's opinion, not a measurement. Use them as a prompt for thinking.</p>
    <div class="metrics"><div class="metric"><b>${r.overall}/100</b><span>Voice match</span></div></div>`;
  if (r.dimensions.length) h += `<div class="table-wrap"><table class="tbl"><thead><tr><th>Dimension</th><th class="r">Score</th><th>Why</th></tr></thead><tbody>${r.dimensions.map((d) => `<tr><td>${esc(d.name)}</td><td class="r">${d.score}</td><td>${esc(d.reason)}</td></tr>`).join("")}</tbody></table></div>`;
  h += `</section>`;
  if (r.works_well.length) h += `<section><h3>Already working</h3><ul>${r.works_well.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>`;
  if (r.off_brand.length) h += `<section><h3>Phrases that clash with the voice</h3><p class="hint">Each phrase is quoted from your copy.</p><ul>${r.off_brand.map((o) => `<li>“${esc(o.phrase)}”: ${esc(o.why)}</li>`).join("")}</ul></section>`;
  if (r.rewrites.length) h += `<section><h3>Rewrites</h3>${r.rewrites.map((w, i) => `<details class="rewrite" ${i === 0 ? "open" : ""}><summary>${esc(w.label)}</summary><pre>${esc(w.text)}</pre><button type="button" class="btn ghost small" data-copy="${i}">Copy</button></details>`).join("")}</section>`;
  $("#voice-out").innerHTML = h;
  $$("[data-copy]", $("#voice-out")).forEach((b) => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(r.rewrites[Number(b.dataset.copy)].text); b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy"), 1500); } catch { b.textContent = "Copy failed"; }
  }));
});

// ================================================================== 3. Budget planner (all maths in the browser)
const DEFAULT_ROWS = [
  { ch: "Instagram ads", share: 35, model: "CPM", cost: 150, ctr: 1.0, c2l: 4, l2c: 10 },
  { ch: "Google Search ads", share: 35, model: "CPC", cost: 20, ctr: 3.0, c2l: 6, l2c: 12 },
  { ch: "LinkedIn ads", share: 15, model: "CPC", cost: 60, ctr: 0.6, c2l: 5, l2c: 15 },
  { ch: "Influencer collabs", share: 15, model: "CPM", cost: 100, ctr: 0.8, c2l: 3, l2c: 8 },
];
let rows = load("ms-budget-rows", null) || DEFAULT_ROWS.map((r) => ({ ...r }));

function funnel(spend, r, c2l, rev) {
  const cost = toNum(r.cost), ctr = toNum(r.ctr), l2c = toNum(r.l2c);
  let impressions = null, clicks = null;
  if (r.model === "CPC") { clicks = cost > 0 ? spend / cost : null; impressions = clicks !== null && ctr > 0 ? clicks / (ctr / 100) : null; }
  else { impressions = cost > 0 ? (spend / cost) * 1000 : null; clicks = impressions !== null ? (impressions * ctr) / 100 : null; }
  const leads = clicks !== null ? (clicks * c2l) / 100 : null;
  const customers = leads !== null ? (leads * l2c) / 100 : null;
  const revenue = customers !== null ? customers * rev : null;
  return { spend, impressions, clicks, leads, customers, cpl: leads ? spend / leads : null, cac: customers ? spend / customers : null, revenue, roas: revenue !== null && spend > 0 ? revenue / spend : null };
}
function computePlan(rows, budget, rev, whatIfPct) {
  const res = rows.filter((r) => String(r.ch || "").trim()).map((r) => ({ ch: r.ch.trim(), ...funnel((budget * Math.max(toNum(r.share), 0)) / 100, r, toNum(r.c2l) * (1 + whatIfPct / 100), rev) }));
  const sum = (k) => res.reduce((a, r) => a + (ok(r[k]) ? r[k] : 0), 0);
  const t = { spend: sum("spend"), impressions: sum("impressions"), clicks: sum("clicks"), leads: sum("leads"), customers: sum("customers"), revenue: sum("revenue") };
  t.cpl = t.leads ? t.spend / t.leads : null; t.cac = t.customers ? t.spend / t.customers : null; t.roas = t.spend > 0 ? t.revenue / t.spend : null;
  return { res, t };
}
function bars(items, fmt) {
  const max = Math.max(...items.map((i) => i.v), 1);
  return `<div class="bars">${items.map((i) => `<div class="bar-row"><span>${esc(i.label)}</span><div class="track"><div class="fill" style="width:${(i.v / max) * 100}%"></div></div><b>${fmt(i.v)}</b></div>`).join("")}</div>`;
}
function renderBudget() {
  const budget = Math.max(toNum($("#bud-total").value), 0), rev = Math.max(toNum($("#bud-rev").value), 0), what = toNum($("#bud-whatif").value);
  $("#bud-whatif-out").textContent = (what > 0 ? "+" : "") + what + "%";
  const out = $("#budget-out");
  const { res, t } = computePlan(rows, budget, rev, what);
  if (!res.length) { out.innerHTML = `<p class="empty">Add at least one channel to see results.</p>`; return; }
  const totalShare = rows.reduce((a, r) => a + Math.max(toNum(r.share), 0), 0);
  let h = "";
  if (Math.abs(totalShare - 100) > 0.01) {
    const gap = (budget * (100 - totalShare)) / 100;
    h += `<p class="msg warn">Shares add up to ${fnum(totalShare, 1)}%, so ${inr(Math.abs(gap))} is ${gap > 0 ? "unallocated" : "over-allocated"}. Adjust the Share % column to reach 100%.</p>`;
  }
  h += `<section><h3>Projected totals</h3><div class="metrics">
    <div class="metric"><b>${fnum(t.leads)}</b><span>Leads</span></div><div class="metric"><b>${fnum(t.customers, 1)}</b><span>Customers</span></div>
    <div class="metric"><b>${inr(t.cpl)}</b><span>Cost per lead</span></div><div class="metric"><b>${inr(t.cac)}</b><span>Cost per customer</span></div>
    <div class="metric"><b>${ok(t.roas) ? t.roas.toFixed(2) + "x" : "n/a"}</b><span>Return on ad spend</span></div></div>
    ${t.customers ? `<p class="hint" style="margin-top:1rem">Break-even: each customer would need to bring in ${inr(t.spend / t.customers)} for revenue to equal spend.</p>` : ""}</section>`;
  h += `<section><h3>By channel</h3><div class="table-wrap"><table class="tbl"><thead><tr><th>Channel</th><th class="r">Spend</th><th class="r">Clicks</th><th class="r">Leads</th><th class="r">Customers</th><th class="r">Cost per lead</th><th class="r">Cost per customer</th><th class="r">Revenue</th><th class="r">ROAS</th></tr></thead><tbody>
    ${res.map((r) => `<tr><td>${esc(r.ch)}</td><td class="r">${inr(r.spend)}</td><td class="r">${fnum(r.clicks)}</td><td class="r">${fnum(r.leads)}</td><td class="r">${fnum(r.customers, 1)}</td><td class="r">${inr(r.cpl)}</td><td class="r">${inr(r.cac)}</td><td class="r">${inr(r.revenue)}</td><td class="r">${ok(r.roas) ? r.roas.toFixed(2) + "x" : "n/a"}</td></tr>`).join("")}</tbody>
    <tfoot><tr><td>Total</td><td class="r">${inr(t.spend)}</td><td class="r">${fnum(t.clicks)}</td><td class="r">${fnum(t.leads)}</td><td class="r">${fnum(t.customers, 1)}</td><td class="r">${inr(t.cpl)}</td><td class="r">${inr(t.cac)}</td><td class="r">${inr(t.revenue)}</td><td class="r">${ok(t.roas) ? t.roas.toFixed(2) + "x" : "n/a"}</td></tr></tfoot></table></div></section>`;
  const withLeads = res.filter((r) => ok(r.leads)), withCpl = res.filter((r) => ok(r.cpl));
  h += `<section class="charts"><div><h3>Leads by channel</h3>${bars(withLeads.map((r) => ({ label: r.ch, v: r.leads })), (v) => fnum(v))}</div>
    <div><h3>Cost per lead</h3>${bars(withCpl.map((r) => ({ label: r.ch, v: r.cpl })), inr)}</div></section>`;
  h += `<section><button type="button" class="btn ghost" id="bud-dl">Download results (CSV)</button>
    <p class="hint" style="margin-top:1rem">Projection = budget share, then impressions, clicks, leads and customers, using only your inputs. It is a scenario, not a forecast.</p></section>`;
  out.innerHTML = h;
  $("#bud-dl").addEventListener("click", () => {
    const head = ["Channel", "Spend", "Impressions", "Clicks", "Leads", "Customers", "Cost per lead", "Cost per customer", "Revenue", "ROAS"];
    const cell = (v) => (ok(v) ? Math.round(v * 100) / 100 : "");
    const csv = [head, ...res.map((r) => [`"${r.ch.replace(/"/g, '""')}"`, ...["spend", "impressions", "clicks", "leads", "customers", "cpl", "cac", "revenue", "roas"].map((k) => cell(r[k]))])].map((r) => r.join(",")).join("\n");
    download("budget_plan.csv", csv, "text/csv");
  });
}
function buildBudgetTable() {
  $("#bud-rows").innerHTML = rows.map((r, i) => `<tr>
    <td><input type="text" data-i="${i}" data-k="ch" value="${esc(r.ch)}" aria-label="Channel name"></td>
    <td><input type="number" data-i="${i}" data-k="share" min="0" max="100" step="1" value="${esc(r.share)}" aria-label="Share percent"></td>
    <td><select data-i="${i}" data-k="model" aria-label="Cost model"><option ${r.model === "CPC" ? "selected" : ""}>CPC</option><option ${r.model === "CPM" ? "selected" : ""}>CPM</option></select></td>
    <td><input type="number" data-i="${i}" data-k="cost" min="0" step="any" value="${esc(r.cost)}" aria-label="Unit cost in rupees"></td>
    <td><input type="number" data-i="${i}" data-k="ctr" min="0" max="100" step="any" value="${esc(r.ctr)}" aria-label="Click-through rate percent"></td>
    <td><input type="number" data-i="${i}" data-k="c2l" min="0" max="100" step="any" value="${esc(r.c2l)}" aria-label="Click to lead percent"></td>
    <td><input type="number" data-i="${i}" data-k="l2c" min="0" max="100" step="any" value="${esc(r.l2c)}" aria-label="Lead to customer percent"></td>
    <td><button type="button" class="btn ghost small" data-del="${i}" aria-label="Remove ${esc(r.ch || "channel")}">Remove</button></td></tr>`).join("");
}
$("#bud-rows").addEventListener("input", (e) => {
  const t = e.target;
  if (t.dataset.i === undefined) return;
  rows[Number(t.dataset.i)][t.dataset.k] = t.dataset.k === "ch" || t.dataset.k === "model" ? t.value : t.value;
  store("ms-budget-rows", rows);
  renderBudget();
});
$("#bud-rows").addEventListener("click", (e) => {
  const d = e.target.closest("[data-del]");
  if (!d) return;
  rows.splice(Number(d.dataset.del), 1);
  store("ms-budget-rows", rows);
  buildBudgetTable();
  renderBudget();
});
$("#bud-add").addEventListener("click", () => {
  rows.push({ ch: "New channel", share: 0, model: "CPC", cost: 20, ctr: 2, c2l: 5, l2c: 10 });
  store("ms-budget-rows", rows);
  buildBudgetTable();
  renderBudget();
});
["#bud-total", "#bud-rev", "#bud-whatif"].forEach((s) => $(s).addEventListener("input", renderBudget));
buildBudgetTable();
renderBudget();

// ================================================================== 4. Competitor snapshot
wireForm($("#comp-form"), $("#comp-out"), "Reading the website and news, then summarising. This can take up to a minute.", async (fd) => {
  const name = (fd.get("name") || "").trim();
  if (!name) throw new Error("Enter a competitor name.");
  const r = await callAI("competitor", { name, site: fd.get("site") });
  let h = "";
  if (r.pageError) h += `<p class="msg warn">Website: ${esc(r.pageError)} The snapshot uses news only.</p>`;
  h += `<section><h3>Snapshot: ${esc(r.name)}</h3>${md(r.summary)}<p><button type="button" class="btn ghost" id="comp-dl">Download as Markdown</button></p></section>`;
  h += `<section><h3>Sources used</h3><p class="hint">Check these before you rely on any point above.</p>`;
  if (r.page) {
    h += `<details open><summary>[Site] ${esc(r.site)}</summary><p>Title: ${esc(r.page.title || "n/a")}</p>${r.page.description ? `<p>Description: ${esc(r.page.description)}</p>` : ""}${r.page.headings.length ? `<p>Headings: ${esc(r.page.headings.slice(0, 12).join(" | "))}</p>` : ""}</details>`;
  }
  if (r.news.length) {
    h += `<details open><summary>News from the last 30 days (${r.news.length})</summary><ul>${r.news.map((n, i) => `<li>[News ${i + 1}] ${esc(new Date(n.when).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }))}, ${esc(n.source || "source not given")}: <a href="${esc(safeUrl(n.link))}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a></li>`).join("")}</ul></details>`;
  }
  h += `</section>`;
  $("#comp-out").innerHTML = h;
  $("#comp-dl").addEventListener("click", () => download("competitor_snapshot.md", `# Competitor snapshot: ${r.name}\n\n${r.summary}`, "text/markdown"));
});

// ================================================================== 5. Ad copy lab
fillSelect($("#lab-platform"), Object.keys(PLATFORMS));
chipGroup($("#lab-angles"), ANGLES, ["Benefit-led", "Urgency", "Curiosity", "Humour"], "angles");
let votes = load("ms-lab-votes", {});
let round = 0, votedRound = -1;
function paintTally() {
  const entries = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  $("#lab-tally").innerHTML = entries.length
    ? `<section><h3>Which angles win for you</h3>${bars(entries.map(([label, v]) => ({ label, v })), (v) => `${v} win${v === 1 ? "" : "s"}`)}
       <p class="hint" style="margin-top:1rem">Based on your own picks in this browser. It is a taste test, not proof of what performs. Run a real A/B test before spending money.</p>
       <button type="button" class="btn ghost small" id="lab-reset">Reset tally</button></section>` : "";
  const r = $("#lab-reset");
  if (r) r.addEventListener("click", () => { votes = {}; store("ms-lab-votes", votes); paintTally(); });
}
function renderLab(data) {
  const spec = PLATFORMS[data.platform] || PLATFORMS["Other / no limit"];
  round += 1;
  const myRound = round;
  let h = `<section><h3>Round ${myRound}: which one would you run?</h3>${spec.hint ? `<p class="hint">${esc(spec.hint)}</p>` : ""}</section>`;
  h += data.variants.map((v, i) => {
    const flags = [];
    if (spec.headlineMax && v.headline.length > spec.headlineMax) flags.push(`Headline is ${v.headline.length} characters (limit ${spec.headlineMax}).`);
    if (spec.bodyMax && v.body.length > spec.bodyMax) flags.push(`Body is ${v.body.length} characters (limit ${spec.bodyMax}).`);
    return `<article class="variant"><h4>${esc(v.angle)}</h4>${v.headline ? `<p class="hook">${esc(v.headline)}</p>` : ""}<p>${esc(v.body)}</p>${v.cta ? `<p><strong>Call to action:</strong> ${esc(v.cta)}</p>` : ""}
      ${flags.map((f) => `<p class="msg warn">${esc(f)}</p>`).join("")}
      <div class="actions"><button type="button" class="btn small" data-vote="${i}">I'd run this one</button><span class="count">${v.headline.length} headline, ${v.body.length} body characters</span></div></article>`;
  }).join("");
  $("#lab-out").innerHTML = h;
  $$("[data-vote]", $("#lab-out")).forEach((b) => b.addEventListener("click", () => {
    if (votedRound === myRound) return;
    votedRound = myRound;
    const angle = data.variants[Number(b.dataset.vote)].angle;
    votes[angle] = (votes[angle] || 0) + 1;
    store("ms-lab-votes", votes);
    $$("[data-vote]", $("#lab-out")).forEach((x) => (x.disabled = true));
    b.textContent = "Picked";
    paintTally();
  }));
}
wireForm($("#lab-form"), $("#lab-out"), "Writing variants…", async (fd) => {
  const angles = fd.getAll("angles");
  if (angles.length < 3 || angles.length > 5) throw new Error("Pick between 3 and 5 angles.");
  const input = {
    product: (fd.get("product") || "").trim() || brand.offer || "",
    audience: (fd.get("audience") || "").trim() || brand.audience || "",
    platform: fd.get("platform"), tone: fd.get("tone"), angles,
  };
  renderLab(await callAI("lab", input));
});
paintTally();

// ------------------------------------------------------------------ start
showTool(location.hash.slice(1) || "brief", false);
