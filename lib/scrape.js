// Reads public web pages: competitor homepages, their stylesheets and images, Google News headlines,
// and checks whether links load. A guard stops it ever being pointed at private or internal addresses.

import dns from "node:dns/promises";
import net from "node:net";
import { domainOf, mapLimit } from "./validate.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; MarketingStudio/2.0)", "Accept-Language": "en-IN,en;q=0.9" };

// ---------------------------------------------------------------- address guard
function isPrivateIPv4(ip) {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
  );
}
function isPrivateIPv6(ip) {
  const x = ip.toLowerCase();
  if (x === "::1" || x === "::") return true;
  if (x.startsWith("::ffff:")) {
    const v4 = x.slice(7);
    return net.isIPv4(v4) ? isPrivateIPv4(v4) : true;
  }
  return /^(fc|fd|fe8|fe9|fea|feb)/.test(x);
}
export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true;
}
export async function hostIsPublic(host) {
  if (net.isIP(host)) return !isPrivateIp(host);
  try {
    const addrs = await dns.lookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- safe fetch
/**
 * Fetches a public URL, following up to 5 redirects and re-checking every address.
 * Returns { ok, status, url (final), type, body (Buffer, only for GET), error }.
 */
export async function safeFetch(input, { method = "GET", maxBytes = 1_500_000, timeout = 10000 } = {}) {
  let url = String(input || "").trim();
  if (!url) return { ok: false, error: "No address given." };
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  for (let hop = 0; hop < 6; hop++) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return { ok: false, error: "That does not look like a valid web address." };
    }
    if (!["http:", "https:"].includes(u.protocol)) return { ok: false, error: "That does not look like a valid web address." };
    if (!(await hostIsPublic(u.hostname.replace(/^\[|\]$/g, "")))) return { ok: false, error: "That address is not a public website." };
    let res;
    try {
      res = await fetch(u, { method, headers: UA, redirect: "manual", signal: AbortSignal.timeout(timeout) });
    } catch (e) {
      return { ok: false, url: u.toString(), error: `Could not open the page (${e.name}).` };
    }
    const loc = res.headers.get("location");
    if ([301, 302, 303, 307, 308].includes(res.status) && loc) {
      res.body?.cancel?.().catch(() => {});
      url = new URL(loc, u).toString();
      continue;
    }
    const out = { ok: res.status < 400, status: res.status, url: u.toString(), type: (res.headers.get("content-type") || "").toLowerCase() };
    if (method === "HEAD" || !res.ok) {
      res.body?.cancel?.().catch(() => {});
      if (!res.ok) out.error = `The site returned HTTP ${res.status}. Some sites block automated visits.`;
      return out;
    }
    const chunks = [];
    let size = 0;
    try {
      for await (const c of res.body) {
        chunks.push(c);
        size += c.length;
        if (size > maxBytes) break;
      }
    } catch {
      return { ...out, ok: false, error: "The page could not be read fully." };
    }
    return { ...out, body: Buffer.concat(chunks) };
  }
  return { ok: false, error: "The site redirected too many times." };
}

export async function fetchPage(input) {
  const r = await safeFetch(input);
  if (!r.ok) return { error: r.error || "Could not open the page." };
  return { html: new TextDecoder("utf-8", { fatal: false }).decode(r.body), url: r.url };
}

// Follows redirects (for example Google's grounding links) to find the real page address.
export async function resolveUrl(url) {
  const r = await safeFetch(url, { method: "HEAD", timeout: 6000 });
  return r.url && domainOf(r.url) ? r.url : url;
}

// Checks that a link loads. Some sites refuse HEAD requests, so a small GET is tried too.
export async function checkLink(url) {
  let r = await safeFetch(url, { method: "HEAD", timeout: 8000 });
  if (!r.ok && (r.status === 403 || r.status === 405 || r.status === 400 || !r.status)) {
    r = await safeFetch(url, { method: "GET", maxBytes: 65536, timeout: 8000 });
  }
  return { ok: !!r.ok, status: r.status || 0, url: r.url || url };
}

export const checkLinks = (urls) => mapLimit(urls, 6, checkLink);

// ---------------------------------------------------------------- reading a homepage
const decodeEntities = (s) =>
  s
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)));
const clean = (s) => decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? "").trim() : "";
};

// Title, description, headings and main text of a page.
export function extractPage(html, maxBody = 3500) {
  const stripped = html.replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const title = clean((stripped.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  let description = "";
  for (const m of stripped.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attr(m[0], "name") || attr(m[0], "property")).toLowerCase();
    const content = attr(m[0], "content");
    if ((key === "description" || key === "og:description") && content) {
      description = content;
      if (key === "description") break;
    }
  }
  const uniq = (list, min, max) => {
    const seen = new Set();
    return list.filter((t) => t.length >= min && t.length <= max && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
  };
  const headings = uniq([...stripped.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => clean(m[1])), 2, 200).slice(0, 20);
  const body = [];
  let size = 0;
  for (const t of uniq([...stripped.matchAll(/<(?:p|li)\b[^>]*>([\s\S]*?)<\/(?:p|li)>/gi)].map((m) => clean(m[1])), 40, 1000)) {
    if (size + t.length > maxBody) break;
    body.push(t);
    size += t.length;
  }
  return { title, description, headings, body };
}

// Where a homepage keeps its brand signals: theme colour, share image, icons, logo images and stylesheets.
export function extractBrandSignals(html, baseUrl) {
  const abs = (u) => {
    try {
      const x = new URL(u, baseUrl);
      return ["http:", "https:"].includes(x.protocol) ? x.toString() : "";
    } catch {
      return "";
    }
  };
  let themeColor = "";
  let ogImage = "";
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attr(m[0], "name") || attr(m[0], "property")).toLowerCase();
    const content = attr(m[0], "content");
    if (key === "theme-color" && content) themeColor = content;
    if ((key === "og:image" || key === "twitter:image") && content && !ogImage) ogImage = abs(content);
  }
  const icons = [];
  const stylesheets = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = attr(m[0], "rel").toLowerCase();
    const href = abs(attr(m[0], "href"));
    if (!href) continue;
    if (rel.includes("stylesheet")) stylesheets.push(href);
    else if (rel.includes("apple-touch-icon") || rel.split(/\s+/).includes("icon")) icons.push(href);
  }
  const logos = [];
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const hint = `${attr(tag, "alt")} ${attr(tag, "class")} ${attr(tag, "id")} ${attr(tag, "src")}`.toLowerCase();
    const src = abs(attr(tag, "src") || attr(tag, "data-src"));
    if (src && hint.includes("logo")) logos.push(src);
  }
  const inlineCss = [
    ...[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]),
    ...[...html.matchAll(/\bstyle\s*=\s*"([^"]*)"/gi)].map((m) => m[1]),
  ].join("\n").slice(0, 400_000);
  return { themeColor, ogImage, icons: [...new Set(icons)], logos: [...new Set(logos)], stylesheets: [...new Set(stylesheets)].slice(0, 3), inlineCss };
}

// ---------------------------------------------------------------- colours from code
export function toHex(raw) {
  const s = String(raw || "").trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})(?:[0-9a-f]{2})?$/);
  if (m) {
    const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
    return "#" + h;
  }
  m = s.match(/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/);
  if (m) return "#" + m.slice(1, 4).map((v) => Math.min(Number(v), 255).toString(16).padStart(2, "0")).join("");
  return "";
}
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const isNeutral = (hex) => {
  const c = rgb(hex);
  return Math.max(...c) - Math.min(...c) < 24; // white, black and greys
};

// Distance between two colours, 0 (same) to about 100 (opposite). A rough "redmean" measure, good enough for a warning.
export function colourDistance(a, b) {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const rm = (r1 + r2) / 2;
  const d = Math.sqrt((2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2);
  return Math.round((d / 765) * 100);
}

// The non-grey colours used most often in a set of CSS/SVG texts.
export function topColours(texts, limit = 6) {
  const counts = new Map();
  const re = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3})\b|rgba?\([^)]*\)/gi;
  for (const t of texts) {
    for (const m of String(t).matchAll(re)) {
      const hex = toHex(m[0]);
      if (hex && !isNeutral(hex)) counts.set(hex, (counts.get(hex) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([hex, count]) => ({ hex, count }));
}

// ---------------------------------------------------------------- images
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

// Returns { mimeType, data (base64) } for photos/logos Gemini can read, { svg } for SVG logos, or null.
export async function fetchImage(url) {
  const r = await safeFetch(url, { maxBytes: 1_500_000, timeout: 8000 });
  if (!r.ok || !r.body?.length || r.body.length >= 1_500_000) return null;
  const type = r.type.split(";")[0].trim();
  if (type === "image/svg+xml" || /\.svg(\?|$)/i.test(r.url)) return { svg: r.body.toString("utf8").slice(0, 200_000), url: r.url };
  if (!IMAGE_TYPES.includes(type)) return null;
  return { mimeType: type, data: r.body.toString("base64"), url: r.url };
}

// ---------------------------------------------------------------- Google News
// Headlines from Google News RSS (India English edition) within the last `days` days.
export async function loadNews(query, days = 90, limit = 12) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
  let xml;
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12000) });
    if (!r.ok) return [];
    xml = await r.text();
  } catch {
    return [];
  }
  const cutoff = Date.now() - days * 86400000;
  const tag = (block, name) => {
    const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"));
    return m ? decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim() : "";
  };
  const out = [];
  const seen = new Set();
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const block = m[1];
    const title = tag(block, "title");
    const when = Date.parse(tag(block, "pubDate"));
    const key = title.toLowerCase().slice(0, 90);
    if (!title || Number.isNaN(when) || when < cutoff || seen.has(key)) continue;
    seen.add(key);
    out.push({ title, link: tag(block, "link"), when, source: tag(block, "source") });
  }
  out.sort((a, b) => b.when - a.when);
  return out.slice(0, limit);
}
