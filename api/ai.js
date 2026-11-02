// The one server function behind every AI tool. The browser sends { tool, input, brand }.
// Everything is validated here, prompts are built on the server, and replies are cleaned
// before they go back (for example, quoted phrases must really exist in your copy).

import { callGemini, checkLimits, parseJson, UserError } from "../lib/gemini.js";
import * as P from "../lib/prompts.js";
import { fetchPage, extractPage, loadNews } from "../lib/scrape.js";

const str = (v, max = 3000) => String(v ?? "").trim().slice(0, max);
const num = (v, min, max, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
};
const pick = (v, list, def) => (list.includes(v) ? v : def);
const arr = (v) => (Array.isArray(v) ? v : []);
const strArr = (v, max = 12) => arr(v).map((x) => str(x, 500)).filter(Boolean).slice(0, max);

export function normaliseShares(values) {
  const vals = values.map((v) => Math.max(Number(v) || 0, 0));
  const total = vals.reduce((a, b) => a + b, 0);
  if (!vals.length) return [];
  if (total <= 0) return vals.map(() => 100 / vals.length);
  return vals.map((v) => (v / total) * 100);
}

async function brief(input, brand, ip) {
  const i = {
    product: str(input.product),
    audience: str(input.audience),
    goal: pick(input.goal, P.GOALS, P.GOALS[0]),
    budget: num(input.budget, 1000, 1e9, 100000),
    weeks: Math.round(num(input.weeks, 1, 26, 4)),
    channels: arr(input.channels).filter((c) => P.CHANNELS.includes(c)).slice(0, 8),
    geography: str(input.geography, 200),
    extra: str(input.extra, 500),
  };
  if (!i.product || !i.audience) throw new UserError("Please fill in the product and the audience (or save them in the brand panel).");
  if (!i.channels.length) throw new UserError("Pick at least one channel.");
  const text = await callGemini({ system: P.BRIEF_SYSTEM, prompt: P.briefPrompt(i, brand), json: true, maxTokens: 7000, temperature: 0.7, ip });
  const d = parseJson(text);
  if (!d || typeof d !== "object") throw new UserError("The AI reply could not be read. Please press Generate again.", 502);
  const plan = arr(d.channel_plan).filter((c) => c && typeof c === "object");
  const shares = normaliseShares(plan.map((c) => c.share_pct));
  return {
    budget: i.budget,
    title: i.product.slice(0, 60),
    positioning: str(d.positioning, 1500),
    key_messages: strArr(d.key_messages),
    taglines: strArr(d.taglines),
    channel_plan: plan.map((c, k) => ({
      channel: str(c.channel, 80),
      share_pct: Math.round(shares[k] * 10) / 10,
      role: str(c.role, 500),
      content_ideas: strArr(c.content_ideas, 5),
    })),
    calendar: arr(d.calendar).map((w) => ({ period: str(w?.period, 60), focus: str(w?.focus, 200), actions: strArr(w?.actions, 6) })).slice(0, 26),
    kpis: arr(d.kpis).map((k) => ({ kpi: str(k?.kpi, 120), how_to_measure: str(k?.how_to_measure, 300) })).slice(0, 10),
    assumptions_and_risks: strArr(d.assumptions_and_risks),
  };
}

async function voice(input, brand, ip) {
  const copy = str(input.copy);
  if (!copy) throw new UserError("Paste some copy first.");
  const voiceName = str(input.voice, 80);
  let voiceDesc = "";
  if (voiceName === "__brand__") voiceDesc = str(brand.tone, 400);
  else if (voiceName === "__custom__") voiceDesc = str(input.customVoice, 400);
  else if (P.VOICES[voiceName]) voiceDesc = `${voiceName}: ${P.VOICES[voiceName]}`;
  if (!voiceDesc) throw new UserError("Describe your voice first.");
  const text = await callGemini({
    system: P.VOICE_SYSTEM,
    prompt: P.voicePrompt({ copy, voiceDesc, channel: str(input.channel, 40) || "Other" }),
    json: true, maxTokens: 5000, temperature: 0.4, ip,
  });
  const d = parseJson(text);
  if (!d || typeof d !== "object") throw new UserError("The AI reply could not be read. Please try again.", 502);
  const low = copy.toLowerCase();
  const score = (v) => Math.round(num(v, 0, 100, 0));
  return {
    overall: score(d.overall),
    dimensions: arr(d.dimensions).map((x) => ({ name: str(x?.name, 60), score: score(x?.score), reason: str(x?.reason, 300) })).slice(0, 6),
    // Keep only flagged phrases that truly appear in the copy, so the AI cannot invent quotes.
    off_brand: arr(d.off_brand)
      .map((o) => ({ phrase: str(o?.phrase, 200), why: str(o?.why, 300) }))
      .filter((o) => o.phrase && low.includes(o.phrase.toLowerCase())),
    works_well: strArr(d.works_well, 4),
    rewrites: arr(d.rewrites).map((r) => ({ label: str(r?.label, 60) || "Rewrite", text: str(r?.text, 3000) })).filter((r) => r.text).slice(0, 4),
  };
}

async function competitor(input, brand, ip) {
  const name = str(input.name, 100);
  const site = str(input.site, 300);
  if (!name) throw new UserError("Enter a competitor name.");
  const [pageRes, news] = await Promise.all([site ? fetchPage(site) : Promise.resolve(null), loadNews(`"${name}"`)]);
  const page = pageRes?.html ? extractPage(pageRes.html) : null;
  if (!page && !news.length) {
    throw new UserError(`Nothing could be fetched for this competitor, so there is nothing reliable to summarise.${pageRes?.error ? " Website: " + pageRes.error : ""} Check the spelling or add the website.`, 404);
  }
  const summary = await callGemini({ system: P.SNAPSHOT_SYSTEM, prompt: P.snapshotSources(name, page, news), maxTokens: 3000, temperature: 0.2, ip });
  return {
    name, site, summary, page,
    pageError: pageRes?.error || null,
    news: news.map((n) => ({ title: n.title, link: n.link, source: n.source, when: new Date(n.when).toISOString() })),
  };
}

async function lab(input, brand, ip) {
  const i = {
    product: str(input.product),
    audience: str(input.audience),
    platform: pick(input.platform, Object.keys(P.PLATFORMS), "Other / no limit"),
    tone: str(input.tone, 200),
    angles: arr(input.angles).filter((a) => P.ANGLES.includes(a)).slice(0, 5),
  };
  if (!i.product || !i.audience) throw new UserError("Fill in the product and audience (or the brand panel).");
  if (i.angles.length < 3) throw new UserError("Pick between 3 and 5 angles.");
  const text = await callGemini({ system: P.LAB_SYSTEM, prompt: P.labPrompt(i, brand), json: true, maxTokens: 5000, temperature: 0.9, ip });
  const d = parseJson(text);
  const variants = arr(d?.variants)
    .map((v) => ({ angle: str(v?.angle, 60) || "Variant", headline: str(v?.headline, 400), body: str(v?.body, 3200), cta: str(v?.cta, 120) }))
    .filter((v) => v.headline || v.body)
    .slice(0, i.angles.length);
  if (!variants.length) throw new UserError("The AI reply could not be read. Please try again.", 502);
  return { platform: i.platform, variants };
}

const TOOLS = { brief, voice, competitor, lab };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Use POST." });
  try {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { throw new UserError("Bad request."); }
    }
    body = body && typeof body === "object" ? body : {};
    const run = TOOLS[body.tool];
    if (!run) throw new UserError("Unknown tool.");
    const ip = str(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown", 100).split(",")[0].trim();
    const b = body.brand || {};
    const brand = { name: str(b.name, 100), offer: str(b.offer, 1000), audience: str(b.audience, 1000), tone: str(b.tone, 300) };
    checkLimits(ip);
    const data = await run(body.input || {}, brand, ip);
    return res.status(200).json({ ok: true, data });
  } catch (e) {
    if (e instanceof UserError) return res.status(e.status).json({ ok: false, error: e.message });
    console.error(e);
    return res.status(500).json({ ok: false, error: "Something went wrong on the server. Please try again." });
  }
}
