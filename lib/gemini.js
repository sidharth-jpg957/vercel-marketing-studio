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

export async function callGemini({ system, prompt, json = false, maxTokens = 4000, temperature = 0.7, ip = "unknown" }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new UserError("AI is switched off: no GEMINI_API_KEY has been added in Vercel's Environment Variables yet.", 500);
  }
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      ...(json ? { responseMimeType: "application/json" } : {}),
    },
  };

  let res;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(50000),
      });
    } catch (e) {
      throw new UserError(`Could not reach the AI service (${e.name}). Please try again.`, 502);
    }
    if (res.status !== 503 && res.status !== 500) break; // retry once on a temporary Google error
  }

  if (!res.ok) {
    const detail = (await res.text()).split(key).join("***").slice(0, 300);
    throw new UserError(`The AI could not answer (HTTP ${res.status}). Model: ${model}. Detail from Google: ${detail}`, 502);
  }
  const data = await res.json();
  const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
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
