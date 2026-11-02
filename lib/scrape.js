// Fetches a competitor's public homepage and recent Google News headlines.
// Includes a guard so the site can never be pointed at private/internal addresses.

import dns from "node:dns/promises";
import net from "node:net";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; MarketingStudio/1.0)" };

function isPrivateIPv4(ip) {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || a >= 224
  );
}
function isPrivateIPv6(ip) {
  const x = ip.toLowerCase();
  if (x === "::1" || x === "::") return true;
  if (x.startsWith("::ffff:")) {
    const v4 = x.slice(7);
    return net.isIPv4(v4) ? isPrivateIPv4(v4) : true;
  }
  return x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe8") || x.startsWith("fe9") || x.startsWith("fea") || x.startsWith("feb");
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

// Returns { html, error }. Follows up to 3 redirects, re-checking every address.
export async function fetchPage(input, maxBytes = 1_500_000) {
  let url = (input || "").trim();
  if (!url) return { error: "No website address given." };
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  for (let hop = 0; hop < 4; hop++) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return { error: "That does not look like a valid web address." };
    }
    if (!["http:", "https:"].includes(u.protocol)) return { error: "That does not look like a valid web address." };
    if (!(await hostIsPublic(u.hostname.replace(/^\[|\]$/g, "")))) return { error: "That address is not a public website." };
    let res;
    try {
      res = await fetch(u, { headers: UA, redirect: "manual", signal: AbortSignal.timeout(10000) });
    } catch (e) {
      return { error: `Could not open the page (${e.name}).` };
    }
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.get("location")) {
      url = new URL(res.headers.get("location"), u).toString();
      continue;
    }
    if (res.status >= 400) return { error: `The site returned an error (HTTP ${res.status}). Some sites block automated visits.` };
    const chunks = [];
    let size = 0;
    try {
      for await (const c of res.body) {
        chunks.push(c);
        size += c.length;
        if (size > maxBytes) break;
      }
    } catch {
      return { error: "The page could not be read fully." };
    }
    return { html: new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks)) };
  }
  return { error: "The site redirected too many times." };
}

const decodeEntities = (s) =>
  s
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)));
const clean = (s) => decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

export function extractPage(html, maxBody = 3500) {
  const stripped = html.replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const title = clean((stripped.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  let description = "";
  for (const m of stripped.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = ((tag.match(/\b(?:name|property)\s*=\s*["']([^"']+)["']/i) || [])[1] || "").toLowerCase();
    const content = (tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i) || [])[1];
    if ((key === "description" || key === "og:description") && content) {
      description = decodeEntities(content).trim();
      if (key === "description") break;
    }
  }
  const seenH = new Set();
  const headings = [];
  for (const m of stripped.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)) {
    const t = clean(m[1]);
    if (t && t.length < 200 && !seenH.has(t.toLowerCase())) {
      seenH.add(t.toLowerCase());
      headings.push(t);
    }
  }
  const seenB = new Set();
  const body = [];
  let size = 0;
  for (const m of stripped.matchAll(/<(?:p|li)\b[^>]*>([\s\S]*?)<\/(?:p|li)>/gi)) {
    const t = clean(m[1]);
    if (t.length < 40 || seenB.has(t.toLowerCase())) continue;
    seenB.add(t.toLowerCase());
    if (size + t.length > maxBody) break;
    body.push(t);
    size += t.length;
  }
  return { title, description, headings: headings.slice(0, 20), body };
}

// Google News RSS headlines from the last `days` days.
export async function loadNews(query, days = 30, limit = 12) {
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
