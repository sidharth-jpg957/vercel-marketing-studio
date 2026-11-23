// The one server function behind every AI step. The browser sends { tool, input }.
// Each tool validates its input, gathers evidence, asks the AI, then CHECKS the reply:
// citations must point at real evidence, quotes must appear word for word in that evidence,
// and links are tested before they are shown as working.

import { callJson, checkLimits, UserError } from "../lib/gemini.js";
import { research, evidenceBlock } from "../lib/research.js";
import { fetchPage, extractPage, extractBrandSignals, safeFetch, fetchImage, topColours, toHex, colourDistance, checkLinks } from "../lib/scrape.js";
import { str, num, pick, arr, obj, strArr, knownIds, httpUrl, domainOf, quoteFound } from "../lib/validate.js";
import * as P from "../lib/prompts.js";
import {
  STAGES, STAGE_IDS, KEY_STAGES, KNOW, CATEGORY_TYPES, GOALS, ALL_MARKETS, EXPANSION_MARKETS, ASSET_TYPES, LIMITS, PLAYBOOK, PRINCIPLE_IDS,
} from "../public/shared.js";

const REQUEST_BUDGET_MS = 285_000; // stays under maxDuration (300 s) in vercel.json
const PRINCIPLES = new Set(PRINCIPLE_IDS);
const STAGE_OR_NONE = [...STAGE_IDS, "none"];
const level = (v, list, def) => pick(str(v, 20).toLowerCase(), list, def);

// ================================================================ input cleaning
function cleanJourney(v) {
  const j = obj(v);
  const stages = {};
  for (const s of STAGES) {
    const st = obj(obj(j.stages)[s.id]);
    const answers = {};
    for (const q of s.questions) {
      const a = str(obj(st.answers)[q.id], 1000);
      if (a) answers[q.id] = a;
    }
    stages[s.id] = { answers, know: pick(st.know, Object.keys(KNOW), ""), notes: str(st.notes, 2000) };
  }
  return { product: str(j.product, 300), buyer: str(j.buyer, 500), story: str(j.story, 2000), situations: strArr(j.situations, LIMITS.situations, 200), stages };
}

// Stages the marketer could not answer or only guessed, as text.
function journeyGaps(j) {
  const lines = [];
  for (const s of STAGES) {
    const st = j.stages[s.id];
    const empty = s.questions.filter((q) => !st.answers[q.id]).map((q) => q.q);
    if (st.know === "unknown" || st.know === "guess") lines.push(`${s.label}: marked "${KNOW[st.know]}"`);
    if (empty.length) lines.push(`${s.label}: not answered: ${empty.join(" / ")}`);
  }
  return lines.join("\n");
}

// Evidence sent back by the browser from an earlier research step. Re-cleaned because it came from the browser.
function cleanResearch(v) {
  const r = obj(v);
  const sources = arr(r.sources)
    .map((s) => {
      const url = httpUrl(s?.url);
      return { n: Math.round(num(s?.n, 0, 10000, 0)), url, title: str(s?.title, 200), domain: domainOf(url) };
    })
    .filter((s) => s.n && s.url)
    .slice(0, 300);
  const known = new Set(sources.map((s) => s.n));
  const evidence = arr(r.evidence)
    .map((e) => ({
      id: str(e?.id, 8).toUpperCase(),
      text: str(e?.text, 700),
      kind: pick(e?.kind, ["search", "news", "site"], "search"),
      ...(/^\d{4}-\d{2}-\d{2}$/.test(e?.date) ? { date: e.date } : {}),
      sources: [...new Set(arr(e?.sources).map(Number))].filter((n) => known.has(n)).slice(0, 12),
    }))
    .filter((e) => /^E\d{1,3}$/.test(e.id) && e.text && e.sources.length)
    .slice(0, 100);
  return { grounded: !!r.grounded, notice: str(r.notice, 500), evidence, sources, queries: strArr(r.queries, 20, 200), suggestions: str(r.suggestions, 30000) };
}

function cleanCompetitor(v) {
  const c = obj(v);
  const out = { name: str(c.name, 100), site: str(c.site, 300), notes: str(c.notes, 1500) };
  if (!out.name) throw new UserError("Enter the competitor's name.");
  return out;
}

// Helpers for checking AI citations against the evidence list.
function evidenceTools(ev) {
  const map = new Map(ev.map((e) => [e.id, e]));
  const ids = new Set(map.keys());
  const cites = (v) => knownIds(v, ids, 12);
  const sourceCount = (list) => new Set(list.flatMap((id) => map.get(id)?.sources || [])).size;
  const texts = (list) => list.map((id) => map.get(id)?.text || "");
  return { map, ids, cites, sourceCount, texts };
}

// Lines from a homepage, as evidence the research step can carry.
function siteEvidence(page, url) {
  if (!page) return [];
  const out = [];
  if (page.title) out.push(`Website title: "${page.title}"`);
  if (page.description) out.push(`Website description: "${page.description}"`);
  if (page.headings.length) out.push(`Website headings: ${page.headings.slice(0, 12).map((h) => `"${h}"`).join(", ")}`);
  page.body.slice(0, 6).forEach((t) => out.push(`Website text: "${t}"`));
  return out.map((text) => ({ text, url, title: page.title || domainOf(url), kind: "site" }));
}

// ================================================================ Journey
async function journeyFollowup(input, ctx) {
  const journey = P.journeyText(cleanJourney(input.journey));
  if (!journey) throw new UserError("Fill in at least part of the journey first, then ask for follow-up questions.");
  const d = await callJson({ system: P.FOLLOWUP_SYSTEM, prompt: P.followupPrompt(journey), maxTokens: 3000, temperature: 0.4, ...ctx });
  const questions = arr(d.questions)
    .map((q) => ({ stage: level(q?.stage, STAGE_IDS, "trigger"), question: str(q?.question, 300), why: str(q?.why, 300) }))
    .filter((q) => q.question)
    .slice(0, 6);
  if (!questions.length) throw new UserError("The AI did not return any questions. Please try again.", 502);
  return { questions };
}

// ================================================================ GTM strategy
function cleanGtm(v) {
  const i = obj(v);
  const out = {
    product: str(i.product, 1500),
    audience: str(i.audience, 1500),
    categoryType: pick(i.categoryType, CATEGORY_TYPES, CATEGORY_TYPES[0]),
    goal: pick(i.goal, GOALS, GOALS[0]),
    expansion: strArr(i.expansion, 6, 40).filter((m) => EXPANSION_MARKETS.includes(m)),
    weeks: Math.round(num(i.weeks, 2, 52, 12)),
    price: str(i.price, 300),
    different: str(i.different, 1000),
    channels: str(i.channels, 600),
    past: str(i.past, 1500),
    competitors: str(i.competitors, 400),
    extra: str(i.extra, 800),
  };
  if (!out.product || !out.audience) throw new UserError("Please fill in the product and the target audience.");
  return out;
}

async function gtmResearch(input, ctx) {
  const i = cleanGtm(input.form);
  const head = i.product.split(/[.,\n]/)[0].slice(0, 80);
  const newsQueries = [head, ...i.expansion.slice(0, 2).map((m) => `${head} ${m}`)];
  return research({ prompt: P.gtmResearchPrompt(i), newsQueries, newsDays: 180, ...ctx });
}

async function gtmPlan(input, ctx) {
  const i = cleanGtm(input.form);
  const r = cleanResearch(input.research);
  const journey = input.useJourney ? P.journeyText(cleanJourney(input.journey)) : "";
  const E = evidenceTools(r.evidence);
  const d = await callJson({ system: P.GTM_SYSTEM, prompt: P.gtmPlanPrompt(i, evidenceBlock(r.evidence), journey), maxTokens: 14000, temperature: 0.4, ...ctx });

  const principles = (v) => knownIds(v, PRINCIPLES, 9);
  const cost = (v, list = ["low", "medium", "high"]) => level(v, list, list[0]);
  const backed = (ev) => ({ evidence: ev, sources: E.sourceCount(ev) });

  const recommendations = arr(d.recommendations)
    .map((x) => ({
      title: str(x?.title, 150), action: str(x?.action, 1200), why: str(x?.why, 1500), ...backed(E.cites(x?.evidence)),
      principles: principles(x?.principles), stage: level(x?.journey_stage, STAGE_OR_NONE, "none"),
      test: { how: str(x?.test?.how, 600), measure: str(x?.test?.measure, 300), cost: cost(x?.test?.cost) },
    }))
    .filter((x) => x.title && x.action)
    .slice(0, 8);
  if (!recommendations.length) throw new UserError("The AI reply had no usable recommendations. Please press the button again.", 502);

  const lensById = new Map(arr(d.lens_check).map((x) => [str(x?.principle, 4).toUpperCase(), x]));
  const lens = PLAYBOOK.map((p) => {
    const x = lensById.get(p.id);
    return x
      ? { principle: p.id, fit: level(x.fit, ["strong", "weak"], "strong"), fitReason: str(x.fit_reason, 400), status: level(x.status, ["pass", "watch", "fail", "unclear"], "unclear"), note: str(x.note, 600) }
      : { principle: p.id, fit: "strong", fitReason: "", status: "unclear", note: "The AI did not assess this principle." };
  });

  const ex = obj(d.execution);
  return {
    form: i,
    summary: str(d.summary, 800),
    recommendations,
    biggerBets: arr(d.bigger_bets)
      .map((x) => ({
        title: str(x?.title, 150), market: str(x?.market, 60), action: str(x?.action, 1000), why: str(x?.why, 1200), ...backed(E.cites(x?.evidence)),
        principles: principles(x?.principles), mustBeTrue: strArr(x?.must_be_true, 6, 300), cost: cost(x?.cost, ["medium", "high"]), risk: str(x?.main_risk, 400),
      }))
      .filter((x) => x.title && x.action)
      .slice(0, 3),
    touchpoints: arr(d.touchpoints)
      .map((x) => {
        const ev = E.cites(x?.evidence);
        let basis = level(x?.basis, ["evidence", "journey", "hypothesis"], "hypothesis");
        if (basis === "evidence" && !ev.length) basis = "hypothesis"; // "evidence" without a valid citation is not evidence
        if (basis === "journey" && !journey) basis = "hypothesis";
        return { stage: level(x?.stage, STAGE_IDS, "search"), touchpoint: str(x?.touchpoint, 200), action: str(x?.what_to_do, 500), basis, evidence: ev };
      })
      .filter((x) => x.touchpoint)
      .slice(0, 12),
    lens,
    tensions: arr(d.tensions)
      .map((x) => ({ principles: principles(x?.principles), evidence: E.cites(x?.evidence), tension: str(x?.tension, 600), choice: str(x?.choice_for_marketer, 400) }))
      .filter((x) => x.tension)
      .slice(0, 4),
    execution: {
      positioning: str(ex.positioning, 500),
      messages: strArr(ex.messages, 6, 300),
      phases: arr(ex.phases).map((x) => ({ period: str(x?.period, 60), focus: str(x?.focus, 200), actions: strArr(x?.actions, 6, 300) })).filter((x) => x.period).slice(0, 12),
      channels: arr(ex.channels).map((x) => ({ channel: str(x?.channel, 80), role: str(x?.role, 400), stage: level(x?.journey_stage, STAGE_OR_NONE, "none"), principles: principles(x?.principles) })).filter((x) => x.channel).slice(0, 10),
      kpis: arr(ex.kpis).map((x) => ({ kpi: str(x?.kpi, 150), how: str(x?.how_to_measure, 400), principles: principles(x?.principles) })).filter((x) => x.kpi).slice(0, 10),
    },
    notVerified: strArr(d.not_verified, 10, 300),
    assumptions: strArr(d.assumptions, 10, 300),
    usedJourney: !!journey,
  };
}

// ================================================================ Distinct
async function distinctScan(input, ctx) {
  const c = cleanCompetitor(input.competitor);
  const market = pick(input.market, ALL_MARKETS, "India");
  let page = null, pageUrl = "", pageError = "", colours = [], logoColours = [], themeColor = "", images = [];

  if (c.site) {
    const p = await fetchPage(c.site);
    if (p.html) {
      page = extractPage(p.html);
      pageUrl = p.url;
      const sig = extractBrandSignals(p.html, p.url);
      themeColor = toHex(sig.themeColor);
      const css = await Promise.all(sig.stylesheets.map((u) => safeFetch(u, { maxBytes: 800_000, timeout: 8000 }).then((r) => (r.ok ? r.body.toString("utf8") : ""))));
      colours = topColours([sig.inlineCss, ...css]);
      const candidates = [...new Set([...sig.logos.slice(0, 2), sig.ogImage, sig.icons.at(-1)].filter(Boolean))].slice(0, 4);
      const fetched = (await Promise.all(candidates.map((u) => fetchImage(u).catch(() => null)))).filter(Boolean);
      logoColours = topColours(fetched.filter((f) => f.svg).map((f) => f.svg), 4);
      images = fetched.filter((f) => f.data).slice(0, 3).map((f, k) => ({ id: `IMG${k + 1}`, ...f }));
    } else pageError = p.error;
  }

  const r = await research({ prompt: P.distinctResearchPrompt(c, market), extra: siteEvidence(page, pageUrl), ...ctx });
  const E = evidenceTools(r.evidence);
  const base = {
    name: c.name, site: c.site, market, pageError, themeColor, colours, logoColours, userNotes: c.notes,
    images: images.map(({ id, url }) => ({ id, url, description: "" })),
    research: r,
  };
  if (!r.evidence.length && !images.length) return { ...base, assets: [], notFound: [], empty: true };

  const imgIds = new Set(images.map((x) => x.id));
  const allIds = new Set([...E.ids, ...imgIds]);
  const d = await callJson({
    system: P.DISTINCT_SCAN_SYSTEM,
    prompt: P.distinctScanPrompt(c, evidenceBlock(r.evidence), [...imgIds], colours),
    images: images.map(({ mimeType, data }) => ({ mimeType, data })),
    maxTokens: 8000, temperature: 0.2, ...ctx,
  });
  const descriptions = new Map(arr(d.images).map((x) => [str(x?.id, 6).toUpperCase(), str(x?.description, 600)]));
  base.images.forEach((im) => (im.description = descriptions.get(im.id) || ""));
  const assets = arr(d.assets)
    .map((x) => ({ type: pick(x?.type, ASSET_TYPES, "Other"), asset: str(x?.asset, 150), howUsed: str(x?.how_used, 600), cited: knownIds(x?.cited, allIds, 10) }))
    .filter((x) => x.asset && x.cited.length) // an asset without a valid citation is dropped
    .slice(0, 40);
  return { ...base, assets, notFound: strArr(d.not_found, 12, 80) };
}

async function distinctCheck(input, ctx) {
  const proposals = arr(input.proposals)
    .map((p, k) => ({ id: `A${k + 1}`, type: pick(p?.type, ASSET_TYPES, "Other"), description: str(p?.description, 600), colour: toHex(p?.colour) }))
    .filter((p) => p.description)
    .slice(0, LIMITS.proposedAssets);
  if (!proposals.length) throw new UserError("Describe at least one asset idea to check.");
  const journeyData = cleanJourney(input.journey);
  const filled = KEY_STAGES.filter((id) => Object.keys(journeyData.stages[id].answers).length);
  if (filled.length < KEY_STAGES.length) throw new UserError("Fill in the first four journey stages (trigger, looking around, comparing, buying) before checking assets.");
  const journey = P.journeyText(journeyData);

  // Number every competitor asset C1, C2, ... so the AI can only point at documented ones.
  const inventory = [];
  const compColours = [];
  for (const comp of arr(input.inventories).slice(0, LIMITS.competitors)) {
    const name = str(comp?.name, 100);
    if (!name) continue;
    for (const a of arr(comp?.assets).slice(0, 40)) {
      inventory.push({ id: `C${inventory.length + 1}`, text: `${name}: [${pick(a?.type, ASSET_TYPES, "Other")}] ${str(a?.asset, 150)}. ${str(a?.howUsed, 400)}` });
    }
    for (const col of [...new Set(arr(comp?.colours).map((c) => toHex(typeof c === "string" ? c : c?.hex)).filter(Boolean))].slice(0, 10)) {
      inventory.push({ id: `C${inventory.length + 1}`, text: `${name}: [Colour, measured from website code] ${col}` });
      compColours.push({ name, hex: col });
    }
    const notes = str(comp?.userNotes, 1500);
    if (notes) inventory.push({ id: `C${inventory.length + 1}`, text: `${name}: [The marketer's own observation] ${notes}` });
  }
  const invIds = new Set(inventory.map((x) => x.id));
  const invText = new Map(inventory.map((x) => [x.id, x.text]));

  // Measured colour clashes (software, not AI).
  const measured = new Map();
  for (const p of proposals) {
    if (!p.colour) continue;
    const hits = compColours.map((cc) => ({ ...cc, distance: colourDistance(p.colour, cc.hex) })).filter((h) => h.distance <= 20).sort((a, b) => a.distance - b.distance);
    if (hits.length) measured.set(p.id, hits.slice(0, 4));
  }
  const measuredText = [...measured.entries()]
    .map(([id, hits]) => hits.map((h) => `${id} colour is ${h.distance <= 10 ? "very close" : "close"} to ${h.name}'s ${h.hex} (distance ${h.distance} out of 100)`).join("\n"))
    .join("\n");

  const d = await callJson({
    system: P.DISTINCT_CHECK_SYSTEM,
    prompt: P.distinctCheckPrompt(proposals, inventory.map((x) => `${x.id}: ${x.text}`).join("\n"), journey, measuredText),
    maxTokens: 9000, temperature: 0.3, ...ctx,
  });
  const byId = new Map(arr(d.checks).map((x) => [str(x?.id, 4).toUpperCase(), x]));
  const order = ["none", "partial", "strong"];
  return {
    checks: proposals.map((p) => {
      const x = obj(byId.get(p.id));
      const hits = measured.get(p.id) || [];
      let lvl = level(x.collision?.level, order, "none");
      const codeLvl = hits.length ? (hits[0].distance <= 10 ? "strong" : "partial") : "none";
      if (order.indexOf(codeLvl) > order.indexOf(lvl)) lvl = codeLvl; // software measurement wins over a softer AI view
      return {
        proposal: p,
        measured: hits,
        assessed: byId.has(p.id),
        collision: { level: lvl, with: knownIds(x.collision?.with, invIds, 6).map((id) => invText.get(id)), explanation: str(x.collision?.explanation, 700) },
        journeyFit: { stages: strArr(x.journey_fit?.stages, 6, 20).filter((s) => STAGE_IDS.includes(s)), where: str(x.journey_fit?.where_noticed, 500), gap: str(x.journey_fit?.gap, 500) },
        memory: { association: str(x.memory_link?.association, 400), relevance: str(x.memory_link?.relevance, 500) },
        test: { method: str(x.test?.method, 600), question: str(x.test?.question, 300) },
        questionsBack: strArr(x.questions_back, 3, 300),
      };
    }),
  };
}

// ================================================================ Data finder
function cleanData(v) {
  const i = obj(v);
  const out = { idea: str(i.idea, 1500), market: pick(i.market, ALL_MARKETS, "India"), decisions: str(i.decisions, 800) };
  if (!out.idea) throw new UserError("Describe what you are planning first.");
  return out;
}

async function dataSearch(input, ctx) {
  return research({ prompt: P.dataResearchPrompt(cleanData(input.form)), ...ctx });
}

async function dataStructure(input, ctx) {
  const i = cleanData(input.form);
  const r = cleanResearch(input.research);
  const gaps = input.useJourney ? journeyGaps(cleanJourney(input.journey)) : "";
  const E = evidenceTools(r.evidence);
  const d = await callJson({ system: P.DATA_SYSTEM, prompt: P.dataStructurePrompt(i, evidenceBlock(r.evidence), gaps), maxTokens: 10000, temperature: 0.2, ...ctx });

  const sourceByN = new Map(r.sources.map((s) => [s.n, s]));
  const found = arr(d.found)
    .map((x) => {
      const cited = E.cites(x?.cited);
      const links = [...new Set(cited.flatMap((id) => E.map.get(id).sources))].map((n) => sourceByN.get(n)).filter(Boolean).slice(0, 4);
      return { name: str(x?.name, 200), publisher: str(x?.publisher, 200), covers: str(x?.covers, 600), why: str(x?.why_useful, 600), access: level(x?.access, ["free", "paid", "unknown"], "unknown"), cited, links: links.map((s) => ({ url: s.url, title: s.title || s.domain })) };
    })
    .filter((x) => x.name && x.cited.length)
    .slice(0, 25);
  const suggested = arr(d.suggested_links)
    .map((x) => ({ name: str(x?.name, 200), url: httpUrl(x?.url), why: str(x?.why_useful, 600) }))
    .filter((x) => x.name && x.url)
    .slice(0, 20);

  // Test every link: found-item links and AI-suggested links.
  const urls = [...new Set([...found.flatMap((f) => f.links.map((l) => l.url)), ...suggested.map((s) => s.url)])].slice(0, 60);
  const results = new Map((await checkLinks(urls)).map((res, k) => [urls[k], res]));
  found.forEach((f) => f.links.forEach((l) => Object.assign(l, { ok: !!results.get(l.url)?.ok })));
  suggested.forEach((s) => {
    const res = results.get(s.url);
    s.ok = !!res?.ok;
    if (res?.ok && res.url) s.url = res.url;
  });

  return {
    form: i,
    usedJourney: !!gaps,
    checked: found.filter((f) => f.links.some((l) => l.ok)),
    checkedSuggested: suggested.filter((s) => s.ok),
    unconfirmed: found.filter((f) => !f.links.some((l) => l.ok)),
    unconfirmedSuggested: suggested.filter((s) => !s.ok),
    notPublic: arr(d.not_public).map((x) => ({ name: str(x?.name, 200), holder: str(x?.holder, 200), covers: str(x?.covers, 500), how: str(x?.how_to_get, 400) })).filter((x) => x.name).slice(0, 15),
    ideal: arr(d.ideal)
      .map((x) => ({
        dataset: str(x?.dataset, 500), why: str(x?.why, 500), available: level(x?.likely_available, ["yes", "partly", "unlikely"], "unlikely"),
        method: str(x?.primary_research?.method, 300), ask: str(x?.primary_research?.what_to_ask, 500), effort: level(x?.primary_research?.effort, ["low", "medium", "high"], "medium"),
      }))
      .filter((x) => x.dataset)
      .slice(0, 8),
    surveyQuestions: strArr(d.survey_questions, 10, 300),
  };
}

// ================================================================ Competitor snapshot
async function compResearch(input, ctx) {
  const c = cleanCompetitor(input.competitor);
  const market = pick(input.market, ALL_MARKETS, "India");
  let page = null, pageError = "", url = "";
  if (c.site) {
    const p = await fetchPage(c.site);
    if (p.html) { page = extractPage(p.html); url = p.url; } else pageError = p.error;
  }
  const r = await research({ prompt: P.compResearchPrompt(c, market), newsQueries: [`"${c.name}"`], newsDays: 180, extra: siteEvidence(page, url), ...ctx });
  return { ...r, pageError };
}

async function compStructure(input, ctx) {
  const c = cleanCompetitor(input.competitor);
  const market = pick(input.market, ALL_MARKETS, "India");
  const r = cleanResearch(input.research);
  if (!r.evidence.length) throw new UserError(`No evidence was found for ${c.name}, so there is nothing reliable to summarise. Check the spelling or add the website.`, 404);
  const E = evidenceTools(r.evidence);
  const d = await callJson({ system: P.COMP_SYSTEM, prompt: P.compStructurePrompt(c, market, str(input.product, 600), evidenceBlock(r.evidence)), maxTokens: 9000, temperature: 0.2, ...ctx });

  const cited = (x) => E.cites(x?.cited);
  const point = (x, max) => {
    const ids = cited(x);
    const text = str(x?.text, max);
    return text && ids.length ? { text, cited: ids } : null;
  };
  // A quote survives only if it appears word for word in the evidence it cites.
  const quote = (text, ids) => (ids.length && quoteFound(text, E.texts(ids)) ? { text: str(text, 400), cited: ids } : null);
  const b = obj(d.brief);
  const brief = {
    who: point(b.who, 600),
    positioning: point(b.positioning, 600),
    audience: point(b.audience, 500),
    claims: arr(b.claims).map((x) => quote(x?.quote, cited(x))).filter(Boolean).slice(0, 8),
    channels: arr(b.channels).map((x) => ({ channel: str(x?.channel, 120), cited: cited(x) })).filter((x) => x.channel && x.cited.length).slice(0, 10),
  };

  const timeline = arr(d.timeline)
    .map((x) => {
      const ids = cited(x);
      if (!ids.length || !str(x?.event)) return null;
      const dates = ids.map((id) => E.map.get(id).date).filter(Boolean).sort();
      const dateText = str(x?.date_text, 60);
      const date = dates[0] || (dateText && quoteFound(dateText, E.texts(ids)) ? dateText : "");
      return { date, sortKey: dates[0] || "", event: str(x.event, 500), category: level(x?.category, ["launch", "promotion", "price", "partnership", "campaign", "expansion", "funding", "other"], "other"), cited: ids };
    })
    .filter(Boolean)
    .sort((a, b) => (b.sortKey || "").localeCompare(a.sortKey || ""))
    .slice(0, 20)
    .map(({ sortKey, ...rest }) => rest);

  const themes = (list) =>
    arr(list)
      .map((t) => ({ theme: str(t?.theme, 200), quotes: arr(t?.quotes).map((q) => quote(q?.text, cited(q))).filter(Boolean).slice(0, 4) }))
      .filter((t) => t.theme && t.quotes.length)
      .slice(0, 6);
  const cv = obj(d.customer_views);
  const praise = themes(cv.praise);
  const complaints = themes(cv.complaints);
  const allQuotes = [...praise, ...complaints].flatMap((t) => t.quotes);
  const quoteSources = new Set(allQuotes.flatMap((q) => q.cited.flatMap((id) => E.map.get(id).sources)));

  return {
    name: c.name, site: c.site, market,
    brief, timeline,
    customerViews: { praise, complaints, quoteCount: allQuotes.length, sourceCount: quoteSources.size },
    hypotheses: arr(d.hypotheses).map((x) => ({ text: str(x?.text, 600), basedOn: E.cites(x?.based_on) })).filter((x) => x.text && x.basedOn.length).slice(0, 3),
  };
}

// ================================================================ router
const TOOLS = {
  journey_followup: journeyFollowup,
  gtm_research: gtmResearch,
  gtm_plan: gtmPlan,
  distinct_scan: distinctScan,
  distinct_check: distinctCheck,
  data_search: dataSearch,
  data_structure: dataStructure,
  comp_research: compResearch,
  comp_structure: compStructure,
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Use POST." });
  try {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { throw new UserError("Bad request."); }
    }
    body = obj(body);
    const run = TOOLS[body.tool];
    if (!run) throw new UserError("Unknown tool.");
    const ip = str(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown", 100).split(",")[0].trim();
    checkLimits(ip);
    const data = await run(obj(body.input), { ip, deadline: Date.now() + REQUEST_BUDGET_MS });
    return res.status(200).json({ ok: true, data });
  } catch (e) {
    if (e instanceof UserError) return res.status(e.status).json({ ok: false, error: e.message });
    console.error(e);
    return res.status(500).json({ ok: false, error: "Something went wrong on the server. Please try again." });
  }
}
