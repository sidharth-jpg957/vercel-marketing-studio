// Talks to Google Gemini. The API key lives ONLY in Vercel's Environment Variables (GEMINI_API_KEY),
// never in the browser files.
//
// Optional Environment Variables (all have sensible defaults):
//   GEMINI_MODEL             main model (default gemini-3.8-flash)
//   GEMINI_FALLBACK_MODELS   comma-separated backups tried when the main model is busy
//   GEMINI_THINKING          minimal | low | medium | high | off (default low)
//   GEMINI_TIMEOUT_SECONDS   longest wait for one AI answer (default 200, max 280)
//   DAILY_LIMIT, IP_LIMIT    AI calls per day for the site, and per visitor per hour

export class UserError extends Error {
  constructor(message, status = 400, code = "") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const DEFAULT_MODEL = "gemini-3.8-flash";
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 600);
const IP_LIMIT = Number(process.env.IP_LIMIT || 80);
const THINKING = (process.env.GEMINI_THINKING || "low").toLowerCase();
const CALL_TIMEOUT_MS = Math.min(Math.max(Number(process.env.GEMINI_TIMEOUT_SECONDS) || 200, 20), 280) * 1000;
const FALLBACKS = (process.env.GEMINI_FALLBACK_MODELS ?? "gemini-3.5-flash-lite,gemini-3.6-flash")
  .split(",").map((m) => m.trim()).filter(Boolean);
const HOUR = 60 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- usage limits
// In-memory counters. Vercel may run several copies of the function, so these are "best effort".
// The real safety net is that a free Google key has no billing attached.
const perIp = new Map();
let daily = { day: "", count: 0 };

export function checkLimits(ip) {
  const today = new Date().toISOString().slice(0, 10);
  if (daily.day !== today) daily = { day: today, count: 0 };
  if (daily.count >= DAILY_LIMIT) throw new UserError("The daily AI limit for this site has been reached. Please try again tomorrow.", 429);
  const now = Date.now();
  const b = perIp.get(ip);
  if (!b || b.resetAt < now) perIp.set(ip, { count: 0, resetAt: now + HOUR });
  else if (b.count >= IP_LIMIT) throw new UserError("You have used all your AI calls for this hour. Please come back a little later.", 429);
  if (perIp.size > 5000) perIp.clear();
}
function countUse(ip) {
  daily.count += 1;
  const b = perIp.get(ip);
  if (b) b.count += 1;
}

// ---------------------------------------------------------------- the call
// Two ways of switching on Google Search; the first is the documented generateContent form,
// the second is tried only if Google rejects the first.
const SEARCH_TOOLS = [{ google_search: {} }, { type: "google_search" }];

/**
 * Calls Gemini once (with retries and backup models).
 * search: true switches on Grounding with Google Search (never combined with JSON mode).
 * images: [{ mimeType, data(base64) }] are sent with the prompt.
 * deadline: a Date.now()-style time after which we stop waiting.
 * Returns { text, model, grounding } where grounding is null unless search was used.
 */
export async function callGemini({ system, prompt, json = false, maxTokens = 6000, temperature = 0.3, ip = "unknown", search = false, images = [], deadline }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new UserError("AI is switched off: no GEMINI_API_KEY has been added in Vercel's Environment Variables yet.", 500, "NO_KEY");
  const primary = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const models = [primary, ...FALLBACKS.filter((m) => m !== primary)];
  const stopAt = Math.min(deadline || Infinity, Date.now() + CALL_TIMEOUT_MS);

  let withThinking = THINKING !== "off";
  let toolIndex = 0;
  const makeBody = () => JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: prompt }, ...images.map((im) => ({ inlineData: { mimeType: im.mimeType, data: im.data } }))] }],
    ...(search ? { tools: [SEARCH_TOOLS[toolIndex]] } : {}),
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      ...(json && !search ? { responseMimeType: "application/json" } : {}),
      ...(withThinking ? { thinkingConfig: { thinkingLevel: THINKING } } : {}),
    },
  });

  const tried = [];
  let res = null;
  let errText = "";
  let model = primary;

  outer: for (model of models) {
    tried.push(model);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    for (let attempt = 0; attempt < 5; attempt++) {
      const left = stopAt - Date.now();
      if (left < 3000) throw timeoutError(model);
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: makeBody(),
          signal: AbortSignal.timeout(left),
        });
      } catch (e) {
        if (e.name === "TimeoutError" || e.name === "AbortError") throw timeoutError(model);
        throw new UserError(`Could not reach the AI service (${e.name}). Please try again.`, 502);
      }
      if (res.ok) break outer;
      errText = (await res.text()).split(key).join("***");
      const low = errText.toLowerCase();

      if (res.status === 400 && withThinking && low.includes("thinking")) { withThinking = false; continue; } // model rejects the thinking setting
      if (search && [400, 403].includes(res.status) && /google_search|googlesearch|grounding|tool|unknown name/.test(low)) {
        if (toolIndex < SEARCH_TOOLS.length - 1) { toolIndex += 1; continue; }
        throw new UserError(`Google Search grounding is not available for this key or model (HTTP ${res.status}).`, 400, "SEARCH_UNAVAILABLE");
      }
      if ([429, 500, 503].includes(res.status)) {
        if (attempt === 0 && stopAt - Date.now() > 8000) { await sleep(1000); continue; } // one quick retry
        continue outer; // busy: try the next model
      }
      if (res.status === 404) continue outer; // model name not available: try the next model
      break outer; // anything else (bad key, bad request): stop here
    }
  }

  if (!res || !res.ok) {
    const status = res ? res.status : 0;
    const busy = [429, 500, 503].includes(status);
    throw new UserError(
      busy
        ? `Google's AI is very busy right now (HTTP ${status}). Models tried: ${tried.join(", ")}. Please try again in a minute.`
        : `The AI could not answer (HTTP ${status}). Model: ${model}. Detail from Google: ${errText.slice(0, 300) || "none"}`,
      busy ? 503 : 502,
      busy ? "BUSY" : "",
    );
  }

  const data = await res.json();
  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("").trim();
  if (!text) {
    const reason = cand?.finishReason || data?.promptFeedback?.blockReason;
    throw new UserError(`The AI returned no text${reason ? ` (reason: ${reason})` : ""}. Try rephrasing your input.`, 502);
  }
  countUse(ip);
  return { text, model, truncated: cand?.finishReason === "MAX_TOKENS", grounding: search ? readGrounding(cand, text) : null };
}

function timeoutError(model) {
  return new UserError(`Google's AI took too long to answer (model: ${model}). Please try again in a minute.`, 504, "TIMEOUT");
}

// Pulls the sources and the sentence-to-source links out of a grounded answer.
function readGrounding(cand, text) {
  const gm = cand?.groundingMetadata || {};
  const chunks = (gm.groundingChunks || []).map((c) => ({ uri: c?.web?.uri || "", title: c?.web?.title || "" }));
  const bytes = Buffer.from(text, "utf8");
  const supports = (gm.groundingSupports || [])
    .map((s) => {
      const seg = s?.segment || {};
      const segText = seg.text || (Number.isFinite(seg.endIndex) ? bytes.subarray(seg.startIndex || 0, seg.endIndex).toString("utf8") : "");
      return { text: segText.trim(), chunkIndices: (s?.groundingChunkIndices || []).filter((i) => Number.isInteger(i) && chunks[i]?.uri) };
    })
    .filter((s) => s.text && s.chunkIndices.length);
  // Some answers list citations without sentence links; keep them as plain sources.
  for (const c of cand?.citationMetadata?.citations || []) if (c?.uri) chunks.push({ uri: c.uri, title: c.title || "" });
  return {
    chunks,
    supports,
    queries: (gm.webSearchQueries || []).map(String).slice(0, 20),
    suggestions: typeof gm.searchEntryPoint?.renderedContent === "string" ? gm.searchEntryPoint.renderedContent.slice(0, 30000) : "",
  };
}

// Reads JSON from a model reply, tolerating code fences or stray text. Returns null on failure.
export function parseJson(text) {
  if (!text) return null;
  const t = text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, "").trim();
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a !== -1 && b > a) {
    try { return JSON.parse(t.slice(a, b + 1)); } catch {}
  }
  return null;
}

// Calls Gemini in JSON mode and returns the parsed object, retrying once if the reply is not valid JSON.
export async function callJson(opts) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await callGemini({ ...opts, json: true });
    const d = parseJson(r.text);
    if (d && typeof d === "object") return d;
    if (opts.deadline && opts.deadline - Date.now() < 30000) break;
  }
  throw new UserError("The AI reply could not be read. Please press the button again.", 502);
}
