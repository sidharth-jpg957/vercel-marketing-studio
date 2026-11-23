// Small helpers that clean everything coming in from the browser and everything coming back from the AI.

export const str = (v, max = 3000) => String(v ?? "").trim().slice(0, max);
export const num = (v, min, max, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
};
export const pick = (v, list, def) => (list.includes(v) ? v : def);
export const arr = (v) => (Array.isArray(v) ? v : []);
export const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
export const strArr = (v, max = 12, len = 500) => arr(v).map((x) => str(x, len)).filter(Boolean).slice(0, max);

// Keeps only ids that exist in `known` (a Set), without duplicates.
export const knownIds = (v, known, max = 12) => [...new Set(strArr(v, 40, 20).map((x) => x.toUpperCase()))].filter((x) => known.has(x)).slice(0, max);

export function httpUrl(v) {
  try {
    const u = new URL(str(v, 2000));
    return ["http:", "https:"].includes(u.protocol) ? u.toString() : "";
  } catch {
    return "";
  }
}
export const domainOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

// Lower-cases and flattens quotes, dashes and spaces so a quote can be matched against its source text.
export const normalise = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim();

// True when `quote` appears word for word (after normalising) in any of the texts.
export function quoteFound(quote, texts) {
  const q = normalise(quote).replace(/^["']+|["']+$/g, "").trim();
  if (q.length < 3) return false;
  return texts.some((t) => normalise(t).includes(q));
}

// Runs fn over items with at most `limit` running at once.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
