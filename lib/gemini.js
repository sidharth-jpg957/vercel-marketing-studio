// Talks to Google Gemini. The API key lives ONLY in Vercel's Environment Variables (GEMINI_API_KEY),
// never in the browser files. Change the model with the GEMINI_MODEL environment variable.

export class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const DEFAULT_MODEL = "gemini-3.8-flash";
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 300);       // AI calls per day (per server instance)
const IP_LIMIT = Number(process.env.IP_LIMIT || 25);              // AI calls per visitor per hour
const HOUR = 60 * 60 * 1000;

// Simple in-memory counters. Vercel may run several copies of this function, so these limits are
// "best effort". The real safety net is that a free Google key has no billing attached.
const perIp = new Map();
let daily = { day: "", count: 0 };

export function checkLimits(ip) {
  const today = new Date().toISOString().slice(0, 10);
  if (daily.day !== today) daily = { day: today, count: 0 };
  if (daily.count >= DAILY_LIMIT) {
    throw new UserError("The daily AI limit for this site has been reached. Please try again tomorrow.", 429);
  }
  const now = Date.now();
  const b = perIp.get(ip);
  if (!b || b.resetAt < now) {
    perIp.set(ip, { count: 0, resetAt: now + HOUR });
  } else if (b.count >= IP_LIMIT) {
    throw new UserError("You have used all your AI generations for this hour. Please come back a little later.", 429);
  }
  if (perIp.size > 5000) perIp.clear(); // keep memory small
}

function countUse(ip) {
  daily.count += 1;
  const b = perIp.get(ip);
  if (b) b.count += 1;
}

// How hard the model "thinks" before answering. Lower is faster. Options: minimal, low, medium, high
// (which ones work depends on the model). Set GEMINI_THINKING to "off" to leave the model's default.
const THINKING = (process.env.GEMINI_THINKING || "low").toLowerCase();
const TIME_LIMIT_MS = 100000; // must stay below maxDuration in vercel.json
// If the main model is busy, these backups are tried in order. Change with GEMINI_FALLBACK_MODELS (comma separated).
const FALLBACKS = (process.env.GEMINI_FALLBACK_MODELS ?? "gemini-3.5-flash-lite,gemini-3.6-flash").split(",").map((m) => m.trim()).filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function callGemini({ system, prompt, json = false, maxTokens = 4000, temperature = 0.7, ip = "unknown" }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new UserError("AI is switched off: no GEMINI_API_KEY has been added in Vercel's Environment Variables yet.", 500);
  }
  const primary = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const models = [primary, ...FALLBACKS.filter((m) => m !== primary)];
  const makeBody = (withThinking) => JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      ...(json ? { responseMimeType: "application/json" } : {}),
      ...(withThinking && THINKING !== "off" ? { thinkingConfig: { thinkingLevel: THINKING } } : {}),
    },
  });

  const deadline = Date.now() + TIME_LIMIT_MS;
  const tried = [];
  let res = null;
  let lastModel = primary;

  outer: for (const model of models) {
    lastModel = model;
    tried.push(model);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    let withThinking = true;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: makeBody(withThinking),
          signal: AbortSignal.timeout(Math.max(deadline - Date.now(), 1000)),
        });
      } catch (e) {
        if (e.name === "TimeoutError" || e.name === "AbortError") {
          throw new UserError(`Google's AI took longer than ${TIME_LIMIT_MS / 1000} seconds to answer (model: ${model}). Please try again in a minute.`, 504);
        }
        throw new UserError(`Could not reach the AI service (${e.name}). Please try again.`, 502);
      }
      if (res.ok) break outer;
      if (res.status === 400 && withThinking && THINKING !== "off") {
        // This model may not accept the thinking setting. Try the same model again without it.
        const t = (await res.clone().text()).toLowerCase();
        if (t.includes("thinking")) { withThinking = false; continue; }
      }
      if ([429, 500, 503].includes(res.status)) {
        if (attempt === 0 && Date.now() < deadline - 5000) { await sleep(800); continue; } // one quick retry, then the next model
        break; // busy or rate limited: go to the next model
      }
      if (res.status === 404) break; // this model name is not available: go to the next model
      break outer; // any other error (bad key, bad request): stop here
    }
  }

  if (!res || !res.ok) {
    const status = res ? res.status : 0;
    const detail = res ? (await res.text()).split(key).join("***").slice(0, 300) : "no reply";
    const busy = [429, 500, 503].includes(status);
    throw new UserError(
      busy
        ? `Google's AI is very busy right now (HTTP ${status}). Models tried: ${tried.join(", ")}. Please try again in a minute.`
        : `The AI could not answer (HTTP ${status}). Model: ${lastModel}. Detail from Google: ${detail}`,
      busy ? 503 : 502,
    );
  }
  const data = await res.json();
  const text = (data?.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("").trim();
  if (!text) throw new UserError("The AI returned nothing (it may have declined). Try rephrasing.", 502);
  countUse(ip);
  return text;
}

// Reads JSON from a model reply, tolerating code fences or stray text. Returns null on failure.
export function parseJson(text) {
  if (!text) return null;
  const t = text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, "").trim();
  try {
    return JSON.parse(t);
  } catch {}
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a !== -1 && b > a) {
    try {
      return JSON.parse(t.slice(a, b + 1));
    } catch {}
  }
  return null;
}
