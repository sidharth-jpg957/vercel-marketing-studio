// Marketing Studio front end. Plain JavaScript, no libraries.
// Every AI step calls /api/ai (see api/ai.js). The Journey, scans and history are saved in this browser.

import {
  STAGES, KEY_STAGES, KNOW, CATEGORY_TYPES, GOALS, MARKETS, ALL_MARKETS, ASSET_TYPES, LIMITS,
  PLAYBOOK, PLAYBOOK_BACKDROP, PLAYBOOK_LABEL, PLAYBOOK_SOURCE,
} from "./shared.js";

// ================================================================ helpers
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "#");
const link = (url, text) => `<a href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;
const list = (items) => (items.length ? `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "");
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
// Formats exact dates (2026-11-04). Anything else, such as "March 2026", is shown as written so no detail is invented.
const fmtDate = (text) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text || "")) return text;
  return new Date(text + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};
const stageLabel = (id) => STAGES.find((s) => s.id === id)?.label || "";
const PRINCIPLE = new Map([...PLAYBOOK, PLAYBOOK_BACKDROP].map((p) => [p.id, p]));

function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
function load(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function fillSelect(el, items, selected) {
  el.innerHTML = items.map((c) => `<option ${c === selected ? "selected" : ""}>${esc(c)}</option>`).join("");
}
$$(".market-select").forEach((el) => {
  el.innerHTML = MARKETS.map((g) => `<optgroup label="${esc(g.group)}">${g.items.map((m) => `<option>${esc(m)}</option>`).join("")}</optgroup>`).join("");
});

// ================================================================ server calls
async function api(tool, input) {
  let res;
  try {
    res = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, input }) });
  } catch {
    throw new Error("Could not reach the server. Check your internet connection and try again.");
  }
  let json = null;
  try { json = await res.json(); } catch {}
  if (!res.ok || !json?.ok) {
    if (res.status === 504 && !json) throw new Error("The server ran out of time (Vercel's limit). Please try again; if it keeps happening, try fewer competitors or markets.");
    throw new Error(json?.error || `The server returned an error (HTTP ${res.status}).`);
  }
  return json.data;
}

// A step-by-step progress list with a timer, shown while the AI works.
function progress(out, labels) {
  out.innerHTML = `<div class="progress" role="status"><ol>${labels.map((l) => `<li>${esc(l)}</li>`).join("")}</ol><p class="elapsed"></p></div>`;
  const items = $$(".progress li", out);
  const clock = $(".elapsed", out);
  const t0 = Date.now();
  const tick = () => (clock.textContent = `${Math.round((Date.now() - t0) / 1000)} s so far. Searching and checking sources can take a few minutes.`);
  tick();
  const timer = setInterval(tick, 1000);
  return {
    step(i) {
      items.forEach((li, k) => {
        li.classList.toggle("done", k < i && !li.classList.contains("failed"));
        li.classList.toggle("active", k === i);
      });
    },
    fail(i) { items[i]?.classList.add("failed"); items[i]?.classList.remove("active"); },
    stop() { clearInterval(timer); },
  };
}

// Disables a form's buttons while work runs.
async function busy(form, work) {
  const buttons = $$("button", form);
  buttons.forEach((b) => (b.disabled = true));
  try {
    await work();
  } finally {
    buttons.forEach((b) => (b.disabled = false));
    form.dispatchEvent(new Event("input")); // let forms re-apply their own rules (e.g. Distinct's journey lock)
  }
}

// ================================================================ evidence display (shared by all tools)
// Every result carries research = { notice, grounded, evidence:[{id,text,kind,date,sources}], sources:[{n,url,title,domain}], queries, suggestions }.
function citeChips(ids, scope) {
  return ids.map((id) => (id.startsWith("IMG") ? `<span class="chip img">${esc(id)}</span>` : `<a class="chip cite" href="#ev-${esc(scope)}-${esc(id)}">${esc(id)}</a>`)).join("");
}
function principleChips(ids) {
  return ids.map((id) => {
    const p = PRINCIPLE.get(id);
    return `<span class="chip principle" title="${esc(p ? `${p.title}: ${p.text}` : id)}">${esc(id)}</span>`;
  }).join("");
}
function noticeBlock(r) {
  return `<p class="msg ${r.grounded ? "info" : "warn"}">${esc(r.notice)}</p>`;
}
function evidenceSection(r, scope, open = false) {
  if (!r.evidence.length) return `<section><h3>Evidence</h3><p class="hint">No evidence with a source was found.</p></section>`;
  const byN = new Map(r.sources.map((s) => [s.n, s]));
  const items = r.evidence.map((e) => {
    const srcs = e.sources.map((n) => byN.get(n)).filter(Boolean).map((s) => link(s.url, s.domain || s.title)).join(", ");
    return `<li id="ev-${esc(scope)}-${esc(e.id)}"><b>${esc(e.id)}</b> <span class="kind">${esc(e.kind)}${e.date ? `, ${esc(fmtDate(e.date))}` : ""}</span> ${esc(e.text)} <span class="src">${srcs}</span></li>`;
  }).join("");
  const queries = r.queries?.length ? `<p class="hint">Google searches the AI ran: ${esc(r.queries.join(" · "))}</p>` : "";
  return `<section><details class="evidence-box" ${open ? "open" : ""}><summary>Evidence (${r.evidence.length}) and sources</summary>
    <p class="hint">"search" items come from Google Search results, "news" from Google News headlines, "site" from the company's own website. Click a source to check it.</p>
    <ol class="evidence">${items}</ol>${queries}</details>${searchSuggestions(r)}</section>`;
}
// Google asks that its search suggestions be shown when Search grounding is used. Shown sandboxed.
function searchSuggestions(r) {
  if (!r.suggestions) return "";
  return `<iframe class="gsuggest no-export" title="Google Search suggestions" sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc="${esc('<base target="_blank">' + r.suggestions)}"></iframe>`;
}
// Opens <details> around an evidence item when its chip is clicked.
document.addEventListener("click", (e) => {
  const a = e.target.closest("a.cite");
  if (!a) return;
  const target = document.getElementById(a.getAttribute("href").slice(1));
  if (!target) return;
  e.preventDefault();
  target.closest("details")?.setAttribute("open", "");
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.add("flash");
  setTimeout(() => target.classList.remove("flash"), 1600);
});

// ================================================================ print, download, history
// Converts a result to Markdown for download (headings, paragraphs, list items and table rows).
function toMarkdown(root) {
  const SEL = "h2,h3,h4,p,li,tr,blockquote";
  const lines = [];
  for (const el of root.querySelectorAll(SEL)) {
    if (el.closest(".no-export")) continue;
    const parent = el.parentElement.closest(SEL);
    if (parent && root.contains(parent) && el.tagName !== "TR") continue;
    const text = el.innerText.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const tag = el.tagName;
    if (tag === "H2") lines.push("", `## ${text}`);
    else if (tag === "H3") lines.push("", `### ${text}`);
    else if (tag === "H4") lines.push("", `#### ${text}`);
    else if (tag === "LI") lines.push(`- ${text}`);
    else if (tag === "TR") lines.push(`| ${[...el.cells].map((c) => c.innerText.replace(/\s+/g, " ").trim()).join(" | ")} |`);
    else if (tag === "BLOCKQUOTE") lines.push(`> ${text}`);
    else lines.push("", text);
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n\n_Made with Marketing Studio. AI can be wrong: check each source._\n";
}
function toolbar(out, title, fileBase) {
  const bar = document.createElement("div");
  bar.className = "toolbar no-export";
  bar.innerHTML = `<button type="button" class="btn ghost small" data-act="print">Print or save as PDF</button><button type="button" class="btn ghost small" data-act="md">Download as Markdown</button>`;
  bar.addEventListener("click", (e) => {
    const act = e.target.closest("button")?.dataset.act;
    if (act === "print") {
      $$("details", out).forEach((d) => d.setAttribute("open", ""));
      out.classList.add("print-target");
      document.body.classList.add("printing");
      window.addEventListener("afterprint", () => {
        document.body.classList.remove("printing");
        out.classList.remove("print-target");
      }, { once: true });
      window.print();
    }
    if (act === "md") download(`${fileBase}.md`, `# ${title}\n\n${toMarkdown(out)}`, "text/markdown");
  });
  out.prepend(bar);
}

const TOOL_NAMES = { journey: "Journey", gtm: "GTM strategy", distinct: "Distinct", distinctCheck: "Distinct check", data: "Data finder", competitor: "Competitors" };
const RENDERERS = {}; // tool -> (data) => void, filled in below
let saved = load("ms-history", []);

function saveHistory(tool, title, data) {
  saved = [{ id: Date.now(), tool, title, at: new Date().toISOString(), data }, ...saved].slice(0, 20);
  while (saved.length && !store("ms-history", saved)) saved.pop(); // browser storage full: drop the oldest
}
function paintHistory() {
  $("#history-list").innerHTML = saved.length
    ? saved.map((h) => `<li><div><b>${esc(h.title)}</b><span class="hint">${esc(TOOL_NAMES[h.tool] || h.tool)} · ${esc(new Date(h.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }))}</span></div>
        <div class="history-actions"><button type="button" class="btn small" data-open="${h.id}">Open</button><button type="button" class="btn ghost small" data-del="${h.id}">Delete</button></div></li>`).join("")
    : `<li class="hint">Nothing saved yet. Results are added here automatically when you run a tool.</li>`;
}
$("#history-open").addEventListener("click", () => { paintHistory(); $("#history-dialog").showModal(); });
$("#history-close").addEventListener("click", () => $("#history-dialog").close());
$("#history-clear").addEventListener("click", () => {
  if (!confirm("Delete all saved results from this browser?")) return;
  saved = [];
  store("ms-history", saved);
  paintHistory();
});
$("#history-list").addEventListener("click", (e) => {
  const open = e.target.closest("[data-open]");
  const del = e.target.closest("[data-del]");
  if (del) {
    saved = saved.filter((h) => String(h.id) !== del.dataset.del);
    store("ms-history", saved);
    paintHistory();
  }
  if (open) {
    const h = saved.find((x) => String(x.id) === open.dataset.open);
    if (!h || !RENDERERS[h.tool]) return;
    $("#history-dialog").close();
    showTool(h.tool === "distinctCheck" ? "distinct" : h.tool, true);
    RENDERERS[h.tool](h.data);
  }
});

// ================================================================ navigation
const TOOLS = ["journey", "gtm", "distinct", "data", "competitor"];
function showTool(id, scroll) {
  if (!TOOLS.includes(id)) id = "journey";
  document.body.dataset.tool = id;
  $$(".panel").forEach((p) => (p.hidden = p.id !== "panel-" + id));
  $$("button[data-tool]").forEach((b) => b.setAttribute("aria-current", b.dataset.tool === id ? "true" : "false"));
  if (location.hash !== "#" + id) window.history.replaceState(null, "", "#" + id);
  refreshJourneyStatus();
  if (scroll) $("#workspace").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}
$$("button[data-tool]").forEach((b) => b.addEventListener("click", () => showTool(b.dataset.tool, true)));
window.addEventListener("hashchange", () => showTool(location.hash.slice(1), false));

// ================================================================ 1. Journey
const emptyJourney = () => ({ product: "", buyer: "", story: "", situations: [], stages: Object.fromEntries(STAGES.map((s) => [s.id, { answers: {}, know: "", notes: "" }])) });
let journey = Object.assign(emptyJourney(), load("ms-journey", {}));
STAGES.forEach((s) => (journey.stages[s.id] = Object.assign({ answers: {}, know: "", notes: "" }, journey.stages?.[s.id])));
const saveJourney = () => store("ms-journey", journey);

function journeyStats() {
  const total = STAGES.reduce((a, s) => a + s.questions.length, 0);
  const answered = STAGES.reduce((a, s) => a + s.questions.filter((q) => journey.stages[s.id].answers[q.id]?.trim()).length, 0);
  const keyDone = KEY_STAGES.filter((id) => Object.values(journey.stages[id].answers).some((v) => v?.trim()));
  const gaps = STAGES.filter((s) => {
    const st = journey.stages[s.id];
    return st.know === "guess" || st.know === "unknown" || s.questions.some((q) => !st.answers[q.id]?.trim());
  });
  const hasAny = answered > 0 || journey.situations.length > 0 || STAGES.some((s) => journey.stages[s.id].notes?.trim()) || !!(journey.product || journey.buyer || journey.story).trim();
  return { total, answered, keyDone, gaps, hasAny, keyReady: keyDone.length === KEY_STAGES.length };
}
function paintMeter() {
  const s = journeyStats();
  const pct = Math.round((s.answered / s.total) * 100);
  $("#j-meter").innerHTML = `<div class="meter-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Journey completeness"><div style="width:${pct}%"></div></div>
    <p><b>${s.answered} of ${s.total} questions answered.</b> Key stages done: ${s.keyDone.length} of ${KEY_STAGES.length}${s.keyReady ? " (enough for Distinct's checks)" : ""}.
    ${s.gaps.length ? `Stages with gaps or guesses: ${esc(s.gaps.map((g) => g.label).join(", "))}. These become research ideas in the Data finder.` : "No gaps left."}</p>`;
}
function buildStages() {
  $("#j-stages").innerHTML = STAGES.map((s, n) => {
    const st = journey.stages[s.id];
    return `<fieldset class="stage" data-stage="${s.id}">
      <legend><span class="stage-no">${n + 1}</span> ${esc(s.label)}</legend>
      <p class="hint">${esc(s.intro)}</p>
      ${s.questions.map((q) => `<label>${esc(q.q)}<textarea rows="2" maxlength="1000" data-q="${q.id}" placeholder="${esc(q.ph)}">${esc(st.answers[q.id] || "")}</textarea></label>`).join("")}
      <label>How do you know this?
        <select data-know><option value="">Choose</option>${Object.entries(KNOW).map(([k, v]) => `<option value="${k}" ${st.know === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>
      </label>
      <label>Extra notes and follow-up answers<textarea rows="2" maxlength="2000" data-notes>${esc(st.notes || "")}</textarea></label>
    </fieldset>`;
  }).join("");
}
function paintSituations() {
  $("#j-situations").innerHTML = journey.situations.map((t, i) => `<li><span>${esc(t)}</span><button type="button" aria-label="Remove ${esc(t)}" data-i="${i}">×</button></li>`).join("");
}
function paintJourneyHead() {
  $("#j-product").value = journey.product;
  $("#j-buyer").value = journey.buyer;
  $("#j-story").value = journey.story;
}
$("#j-stages").addEventListener("input", (e) => {
  const fs = e.target.closest("[data-stage]");
  if (!fs) return;
  const st = journey.stages[fs.dataset.stage];
  if (e.target.dataset.q) st.answers[e.target.dataset.q] = e.target.value;
  if (e.target.hasAttribute("data-know")) st.know = e.target.value;
  if (e.target.hasAttribute("data-notes")) st.notes = e.target.value;
  saveJourney();
  paintMeter();
});
[["#j-product", "product"], ["#j-buyer", "buyer"], ["#j-story", "story"]].forEach(([sel, key]) =>
  $(sel).addEventListener("input", (e) => { journey[key] = e.target.value; saveJourney(); paintMeter(); }));
function addSituation() {
  const v = $("#j-situation").value.trim();
  if (!v || journey.situations.length >= LIMITS.situations || journey.situations.includes(v)) return;
  journey.situations.push(v);
  $("#j-situation").value = "";
  saveJourney();
  paintSituations();
}
$("#j-situation-add").addEventListener("click", addSituation);
$("#j-situation").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addSituation(); } });
$("#j-situations").addEventListener("click", (e) => {
  const b = e.target.closest("[data-i]");
  if (!b) return;
  journey.situations.splice(Number(b.dataset.i), 1);
  saveJourney();
  paintSituations();
});
$("#j-clear").addEventListener("click", () => {
  if (!confirm("Clear the whole journey? This cannot be undone.")) return;
  journey = emptyJourney();
  saveJourney();
  paintJourneyHead();
  buildStages();
  paintSituations();
  paintMeter();
  $("#journey-out").innerHTML = "";
});

function renderFollowups(d) {
  const out = $("#journey-out");
  out.innerHTML = `<section><h3>Follow-up questions</h3><p class="hint">Questions only: answer the ones you can. "Add to notes" puts the question into that stage's notes so you can type your answer under it.</p>
    <ol class="followups">${d.questions.map((q, i) => `<li><span class="chip">${esc(stageLabel(q.stage))}</span> <b>${esc(q.question)}</b>${q.why ? `<br><span class="hint">${esc(q.why)}</span>` : ""}
      <br><button type="button" class="btn ghost small no-export" data-add="${i}">Add to notes</button></li>`).join("")}</ol></section>`;
  $$("[data-add]", out).forEach((b) => b.addEventListener("click", () => {
    const q = d.questions[Number(b.dataset.add)];
    const st = journey.stages[q.stage];
    st.notes = `${st.notes ? st.notes.trimEnd() + "\n" : ""}Q: ${q.question}\nA: `;
    saveJourney();
    const ta = $(`[data-stage="${q.stage}"] [data-notes]`);
    ta.value = st.notes;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    b.textContent = "Added";
    b.disabled = true;
  }));
}
$("#j-followup").addEventListener("click", async () => {
  const out = $("#journey-out");
  if (!journeyStats().hasAny) { out.innerHTML = `<p class="msg error">Fill in at least part of the journey first.</p>`; return; }
  const p = progress(out, ["Reading your journey and finding the thin spots"]);
  p.step(0);
  const btn = $("#j-followup");
  btn.disabled = true;
  try {
    renderFollowups(await api("journey_followup", { journey }));
  } catch (err) {
    out.innerHTML = `<p class="msg error">${esc(err.message)}</p>`;
  } finally {
    p.stop();
    btn.disabled = false;
  }
});
paintJourneyHead();
buildStages();
paintSituations();
paintMeter();

// Shows on other tabs whether the Journey is ready.
function refreshJourneyStatus() {
  const s = journeyStats();
  $("#gtm-journey-status").textContent = s.hasAny ? `(${s.answered} of ${s.total} questions answered)` : "(your Journey is empty)";
  const ready = s.keyReady;
  $("#check-journey-status").innerHTML = ready
    ? `Your Journey has the four key stages filled in, so ideas can be checked against it.`
    : `To check ideas, first fill in at least one question in each of the first four Journey stages (${KEY_STAGES.map(stageLabel).join(", ")}). Done: ${s.keyDone.length} of ${KEY_STAGES.length}. <a href="#journey">Open the Journey</a>.`;
  $("#check-submit").disabled = !ready;
}

// ================================================================ 2. GTM strategy
fillSelect($("#gtm-category"), CATEGORY_TYPES);
fillSelect($("#gtm-goal"), GOALS);
$("#gtm-markets").innerHTML = MARKETS.filter((g) => g.group !== "Home").map((g) => `<div><span class="group-name">${esc(g.group)}</span><div class="chips">${g.items.map((m) => `<label><input type="checkbox" name="expansion" value="${esc(m)}"><span>${esc(m)}</span></label>`).join("")}</div></div>`).join("");
$("#gtm-playbook").innerHTML = `<p class="hint">${esc(PLAYBOOK_SOURCE)}</p><dl class="playbook-list">${[...PLAYBOOK, PLAYBOOK_BACKDROP].map((p) => `<dt><span class="chip principle">${esc(p.id)}</span> ${esc(p.title)}</dt><dd>${esc(p.text)} <span class="hint">(Sidharth's notes ${esc(p.notes)})</span></dd>`).join("")}</dl>`;
$("#gtm-markets").addEventListener("change", (e) => {
  if ($$("input:checked", $("#gtm-markets")).length > 6) { e.target.checked = false; alert("Pick up to 6 expansion markets."); }
});

const CONFIDENCE = (n) => (n >= 2 ? ["strong", `Backed by ${n} sources`] : n === 1 ? ["medium", "One source"] : ["none", "Hypothesis: no evidence found"]);
function confidenceBadge(sources) {
  const [cls, text] = CONFIDENCE(sources);
  return `<span class="badge ${cls}">${esc(text)}</span>`;
}
const STATUS_TEXT = { pass: "Pass", watch: "Watch", fail: "Fail", unclear: "Unclear" };

function renderGtm({ research: r, plan }) {
  const out = $("#gtm-out");
  const sc = "gtm";
  const meta = (x) => `<p class="meta">${confidenceBadge(x.sources)}${x.stage && x.stage !== "none" ? `<span class="chip">${esc(stageLabel(x.stage))}</span>` : ""}${principleChips(x.principles)}${citeChips(x.evidence, sc)}</p>`;
  let h = noticeBlock(r);
  if (!plan.usedJourney) h += `<p class="msg warn">This plan did not use a Journey. Filling in the Journey tab makes touchpoints and recommendations much more specific.</p>`;
  h += `<section><h2 class="result-title">${esc(plan.form.product.split("\n")[0].slice(0, 90))}</h2><p class="positioning">${esc(plan.summary)}</p></section>`;

  h += `<section><h3>Recommendations</h3><p class="hint">Each recommendation shows how much evidence backs it. Click an E number to see the source.</p>
    ${plan.recommendations.map((x) => `<article class="card"><h4>${esc(x.title)}</h4><p>${esc(x.action)}</p><p class="why">${esc(x.why)}</p>${meta(x)}
      ${x.test.how ? `<div class="test"><b>Test it first</b> (${esc(x.test.cost)} cost): ${esc(x.test.how)}${x.test.measure ? ` <br><b>Measure:</b> ${esc(x.test.measure)}` : ""}</div>` : ""}</article>`).join("")}</section>`;

  if (plan.biggerBets.length) {
    h += `<section><h3>Bigger bets</h3><p class="hint">Costlier moves the evidence points to. Check what must be true before committing.</p>
      ${plan.biggerBets.map((x) => `<article class="card bet"><h4>${esc(x.title)}${x.market ? ` <span class="chip">${esc(x.market)}</span>` : ""} <span class="badge cost">${esc(x.cost)} cost</span></h4>
        <p>${esc(x.action)}</p><p class="why">${esc(x.why)}</p>${x.mustBeTrue.length ? `<p><b>Must be true first:</b></p>${list(x.mustBeTrue)}` : ""}${x.risk ? `<p><b>Main risk:</b> ${esc(x.risk)}</p>` : ""}${meta(x)}</article>`).join("")}</section>`;
  }

  if (plan.touchpoints.length) {
    const basis = { evidence: "From evidence", journey: "From your Journey", hypothesis: "Hypothesis" };
    h += `<section><h3>Journey touchpoints</h3><div class="table-wrap"><table class="tbl"><thead><tr><th>Stage</th><th>Touchpoint</th><th>What to do</th><th>Basis</th></tr></thead><tbody>
      ${plan.touchpoints.map((t) => `<tr><td>${esc(stageLabel(t.stage))}</td><td>${esc(t.touchpoint)}</td><td>${esc(t.action)}</td><td><span class="badge ${t.basis === "hypothesis" ? "none" : "medium"}">${esc(basis[t.basis])}</span> ${citeChips(t.evidence, sc)}</td></tr>`).join("")}
      </tbody></table></div></section>`;
  }

  const weakFitNote = plan.form.categoryType.startsWith("Frequently") ? "" : `<p class="msg warn">Your category is not a frequently bought product. Some of these patterns were mainly shown for frequently bought goods, so check each principle's fit below.</p>`;
  h += `<section class="lens"><h3>${esc(PLAYBOOK_LABEL)}</h3><p class="hint">${esc(PLAYBOOK_SOURCE)}</p>${weakFitNote}
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Principle</th><th>Fit for this category</th><th>Status</th><th>What the plan does</th></tr></thead><tbody>
    ${plan.lens.map((l) => `<tr><td><span class="chip principle">${esc(l.principle)}</span> ${esc(PRINCIPLE.get(l.principle)?.title)}</td><td><span class="badge ${l.fit === "strong" ? "medium" : "none"}">${esc(l.fit)}</span> ${esc(l.fitReason)}</td>
      <td><span class="status ${l.status}">${esc(STATUS_TEXT[l.status])}</span></td><td>${esc(l.note)}</td></tr>`).join("")}</tbody></table></div>
    ${plan.tensions.length ? `<h4>Where evidence and principles pull apart</h4>${plan.tensions.map((t) => `<article class="card tension"><p>${esc(t.tension)}</p>${t.choice ? `<p><b>Your call:</b> ${esc(t.choice)}</p>` : ""}<p class="meta">${principleChips(t.principles)}${citeChips(t.evidence, sc)}</p></article>`).join("")}` : ""}
  </section>`;

  const ex = plan.execution;
  h += `<section><h3>Execution plan</h3>${ex.positioning ? `<p class="positioning small">${esc(ex.positioning)}</p>` : ""}
    ${ex.messages.length ? `<h4>Key messages</h4>${list(ex.messages)}` : ""}
    ${ex.phases.length ? `<h4>Phases</h4>${ex.phases.map((p) => `<details open><summary>${esc(p.period)}: ${esc(p.focus)}</summary>${list(p.actions)}</details>`).join("")}` : ""}
    ${ex.channels.length ? `<h4>Channels</h4><div class="table-wrap"><table class="tbl"><thead><tr><th>Channel</th><th>Role</th><th>Journey stage</th><th>Principles</th></tr></thead><tbody>
      ${ex.channels.map((c) => `<tr><td>${esc(c.channel)}</td><td>${esc(c.role)}</td><td>${esc(stageLabel(c.stage) || "-")}</td><td>${principleChips(c.principles)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${ex.kpis.length ? `<h4>KPIs</h4><div class="table-wrap"><table class="tbl"><thead><tr><th>KPI</th><th>How to measure</th><th>Principles</th></tr></thead><tbody>
      ${ex.kpis.map((k) => `<tr><td>${esc(k.kpi)}</td><td>${esc(k.how)}</td><td>${principleChips(k.principles)}</td></tr>`).join("")}</tbody></table></div>` : ""}
  </section>`;
  if (plan.notVerified.length) h += `<section><h3>What we could not verify</h3>${list(plan.notVerified)}</section>`;
  if (plan.assumptions.length) h += `<section><h3>Assumptions to check</h3>${list(plan.assumptions)}</section>`;
  h += evidenceSection(r, sc);
  out.innerHTML = h;
  toolbar(out, `GTM strategy: ${plan.form.product.slice(0, 60)}`, "gtm_strategy");
}
RENDERERS.gtm = renderGtm;

$("#gtm-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const out = $("#gtm-out");
  const input = {
    product: (fd.get("product") || "").trim() || journey.product,
    audience: (fd.get("audience") || "").trim() || journey.buyer,
    categoryType: fd.get("categoryType"), goal: fd.get("goal"), weeks: Number(fd.get("weeks")) || 12,
    expansion: fd.getAll("expansion"),
    price: fd.get("price"), different: fd.get("different"), channels: fd.get("channels"), past: fd.get("past"), competitors: fd.get("competitors"), extra: fd.get("extra"),
  };
  if (!input.product || !input.audience) { out.innerHTML = `<p class="msg error">Fill in the product and audience, or add them on the Journey tab.</p>`; return; }
  const useJourney = !!fd.get("useJourney") && journeyStats().hasAny;
  busy(form, async () => {
    const p = progress(out, ["Searching Google and news for recent evidence", "Building the strategy from the evidence and checking every citation"]);
    let step = 0;
    try {
      p.step(0);
      const r = await api("gtm_research", { form: input });
      step = 1;
      p.step(1);
      const plan = await api("gtm_plan", { form: input, research: r, journey: useJourney ? journey : null, useJourney });
      const data = { research: r, plan };
      renderGtm(data);
      saveHistory("gtm", `GTM: ${input.product.slice(0, 60)}`, data);
    } catch (err) {
      p.fail(step);
      out.insertAdjacentHTML("beforeend", `<p class="msg error">${esc(err.message)}</p>`);
    } finally {
      p.stop();
    }
  });
});

// ================================================================ 3. Distinct
let scans = load("ms-distinct-scans", []);
let ideas = load("ms-distinct-ideas", [{ type: "Colour", description: "", colour: "" }]);

function compRows(el, withNotes, saved = []) {
  el.innerHTML = Array.from({ length: LIMITS.competitors }, (_, k) => {
    const c = saved[k] || {};
    return `<fieldset class="comp"><legend>Competitor ${k + 1}${k ? " (optional)" : ""}</legend>
      <div class="two"><label>Name <input type="text" name="name" maxlength="100" value="${esc(c.name || "")}" placeholder="${k ? "" : "e.g. Colgate"}"></label>
      <label>Website <input type="text" name="site" maxlength="300" value="${esc(c.site || "")}" placeholder="${k ? "" : "e.g. colgate.com/en-in"}"></label></div>
      ${withNotes ? `<label>What you've noticed in stores, ads or packaging (optional) <textarea name="notes" rows="2" maxlength="1500" placeholder="e.g. red carton, the 'dentist recommended' line in TV ads">${esc(c.notes || "")}</textarea></label>` : ""}
    </fieldset>`;
  }).join("");
}
const readComps = (el) => $$("fieldset.comp", el).map((fs) => ({ name: $("[name=name]", fs).value.trim(), site: $("[name=site]", fs).value.trim(), notes: $("[name=notes]", fs)?.value.trim() || "" })).filter((c) => c.name);

compRows($("#distinct-comps"), true, load("ms-distinct-comps", []));
$("#distinct-comps").addEventListener("input", () => store("ms-distinct-comps", readComps($("#distinct-comps"))));

function swatches(cols, note) {
  if (!cols.length) return "";
  return `<div class="swatches">${cols.map((c) => `<span class="swatch-item"><span class="swatch" style="background:${esc(c.hex)}"></span><code>${esc(c.hex)}</code>${c.count ? `<span class="hint">${esc(note)} ${c.count}×</span>` : ""}</span>`).join("")}</div>`;
}
function renderScan(s, k) {
  const sc = `scan${k}`;
  let h = `<article class="comp-card"><h3>${esc(s.name)}${s.site ? ` <span class="hint">${esc(s.site)}</span>` : ""}</h3>${noticeBlock(s.research)}`;
  if (s.pageError) h += `<p class="msg warn">Website: ${esc(s.pageError)} Colours and images could not be read.</p>`;
  if (s.colours.length || s.themeColor || s.logoColours.length) {
    h += `<h4>Colours measured from their website code</h4><p class="hint">Counted by software from their stylesheets. Greys, black and white are left out; some colours may be generic interface colours.</p>`;
    if (s.themeColor) h += `<p>Declared theme colour: ${swatches([{ hex: s.themeColor }])}</p>`;
    h += swatches(s.colours, "used");
    if (s.logoColours.length) h += `<p class="hint">Colours inside their logo file:</p>${swatches(s.logoColours, "used")}`;
  }
  if (s.images.length) {
    h += `<h4>Images from their website</h4><p class="hint">Described by AI: check each description against the image yourself.</p><div class="images">
      ${s.images.map((im) => `<figure><img src="${esc(safeUrl(im.url))}" alt="" loading="lazy" referrerpolicy="no-referrer"><figcaption><b>${esc(im.id)}</b> ${esc(im.description || "No description returned.")}</figcaption></figure>`).join("")}</div>`;
  }
  if (s.assets.length) {
    const byType = ASSET_TYPES.map((t) => [t, s.assets.filter((a) => a.type === t)]).filter(([, a]) => a.length);
    h += `<h4>Assets documented (${s.assets.length})</h4><div class="table-wrap"><table class="tbl"><thead><tr><th>Type</th><th>Asset</th><th>How they use it</th><th>Where seen</th></tr></thead><tbody>
      ${byType.map(([t, items]) => items.map((a, i) => `<tr><td>${i ? "" : esc(t)}</td><td>${esc(a.asset)}</td><td>${esc(a.howUsed)}</td><td>${citeChips(a.cited, sc)}</td></tr>`).join("")).join("")}</tbody></table></div>`;
  } else if (!s.empty) h += `<p class="hint">No assets could be documented from the evidence found.</p>`;
  if (s.empty) h += `<p class="msg warn">Nothing could be found for this competitor. Check the name and website.</p>`;
  if (s.notFound?.length) h += `<p class="hint">No evidence found for: ${esc(s.notFound.join(", "))}.</p>`;
  if (s.userNotes) h += `<h4>From you</h4><blockquote>${esc(s.userNotes)}</blockquote>`;
  h += evidenceSection(s.research, sc);
  return h + `</article>`;
}
function renderScans(list) {
  const out = $("#distinct-scan-out");
  out.innerHTML = list.map((s, k) => (s.error ? `<article class="comp-card"><h3>${esc(s.name)}</h3><p class="msg error">${esc(s.error)}</p></article>` : renderScan(s, k))).join("");
  toolbar(out, "Competitors' distinctive assets", "distinct_scan");
}
RENDERERS.distinct = (data) => { scans = data; store("ms-distinct-scans", scans); renderScans(scans); };

$("#distinct-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target;
  const out = $("#distinct-scan-out");
  const comps = readComps($("#distinct-comps"));
  const market = form.market.value;
  if (!comps.length) { out.innerHTML = `<p class="msg error">Enter at least one competitor's name.</p>`; return; }
  busy(form, async () => {
    const p = progress(out, comps.map((c) => `Scanning ${c.name}: website, colours, images and search`));
    const results = [];
    for (const [k, c] of comps.entries()) {
      p.step(k);
      try {
        results.push(await api("distinct_scan", { competitor: c, market }));
      } catch (err) {
        p.fail(k);
        results.push({ name: c.name, error: err.message });
      }
    }
    p.stop();
    scans = results;
    store("ms-distinct-scans", scans.filter((s) => !s.error));
    renderScans(results);
    if (results.some((s) => !s.error)) saveHistory("distinct", `Distinct scan: ${comps.map((c) => c.name).join(", ")}`, results);
  });
});
if (scans.length) renderScans(scans);

function paintIdeas() {
  $("#check-rows").innerHTML = ideas.map((x, i) => `<fieldset class="idea" data-i="${i}"><legend>Idea ${i + 1}</legend>
    <div class="two"><label>Type <select data-k="type">${ASSET_TYPES.map((t) => `<option ${t === x.type ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
    <label>Colour (optional) <span class="colour-field"><input type="text" data-k="colour" maxlength="7" value="${esc(x.colour)}" placeholder="#FF2E88"><span class="swatch" style="background:${/^#[0-9a-f]{6}$/i.test(x.colour) ? esc(x.colour) : "transparent"}"></span></span></label></div>
    <label>Describe the idea <textarea data-k="description" rows="2" maxlength="600" placeholder="e.g. a green leaf drawn as a smile on every tube and ad">${esc(x.description)}</textarea></label>
    ${ideas.length > 1 ? `<button type="button" class="btn ghost small" data-remove="${i}">Remove</button>` : ""}</fieldset>`).join("");
  $("#check-add").hidden = ideas.length >= LIMITS.proposedAssets;
}
$("#check-rows").addEventListener("input", (e) => {
  const fs = e.target.closest("[data-i]");
  if (!fs || !e.target.dataset.k) return;
  ideas[Number(fs.dataset.i)][e.target.dataset.k] = e.target.value;
  store("ms-distinct-ideas", ideas);
  if (e.target.dataset.k === "colour") $(".swatch", fs).style.background = /^#[0-9a-f]{6}$/i.test(e.target.value) ? e.target.value : "transparent";
});
$("#check-rows").addEventListener("click", (e) => {
  const b = e.target.closest("[data-remove]");
  if (!b) return;
  ideas.splice(Number(b.dataset.remove), 1);
  store("ms-distinct-ideas", ideas);
  paintIdeas();
});
$("#check-add").addEventListener("click", () => {
  if (ideas.length >= LIMITS.proposedAssets) return;
  ideas.push({ type: "Colour", description: "", colour: "" });
  store("ms-distinct-ideas", ideas);
  paintIdeas();
});
$("#check-form").addEventListener("input", refreshJourneyStatus);
paintIdeas();

const LEVEL_TEXT = { none: "No clash found", partial: "Partial clash", strong: "Strong clash" };
function renderChecks(d) {
  const out = $("#distinct-check-out");
  out.innerHTML = `<p class="msg info">AI judgement, based only on your Journey and the competitors you scanned. Colour clashes are measured by software. Use this as one input to your decision.</p>` +
    d.checks.map((c) => {
      const p = c.proposal;
      return `<article class="card check"><h4>${esc(p.type)}${p.colour ? ` <span class="swatch" style="background:${esc(p.colour)}"></span> <code>${esc(p.colour)}</code>` : ""}</h4><p>${esc(p.description)}</p>
        ${c.assessed ? "" : `<p class="msg warn">The AI did not assess this idea. Please run the check again.</p>`}
        <h5>Clash with competitors <span class="status ${c.collision.level === "none" ? "pass" : c.collision.level === "partial" ? "watch" : "fail"}">${esc(LEVEL_TEXT[c.collision.level])}</span></h5>
        ${c.measured.length ? `<ul>${c.measured.map((m) => `<li>Measured: ${m.distance <= 10 ? "very close" : "close"} to ${esc(m.name)}'s <span class="swatch" style="background:${esc(m.hex)}"></span> <code>${esc(m.hex)}</code> (distance ${m.distance} of 100)</li>`).join("")}</ul>` : ""}
        ${c.collision.with.length ? `<p class="hint">Overlaps with:</p>${list(c.collision.with)}` : ""}
        ${c.collision.explanation ? `<p>${esc(c.collision.explanation)}</p>` : ""}
        <h5>Fit with your journey</h5><p class="meta">${c.journeyFit.stages.map((s) => `<span class="chip">${esc(stageLabel(s))}</span>`).join("")}</p>
        ${c.journeyFit.where ? `<p><b>Where it would be noticed:</b> ${esc(c.journeyFit.where)}</p>` : ""}${c.journeyFit.gap ? `<p><b>Where it would be missing:</b> ${esc(c.journeyFit.gap)}</p>` : ""}
        <h5>Memory link</h5>${c.memory.association ? `<p><b>Likely association:</b> ${esc(c.memory.association)}</p>` : ""}${c.memory.relevance ? `<p><b>Relevance when buying:</b> ${esc(c.memory.relevance)}</p>` : ""}
        <h5>How to test it</h5>${c.test.method ? `<p>${esc(c.test.method)}</p>` : ""}${c.test.question ? `<blockquote>${esc(c.test.question)}</blockquote>` : ""}
        ${c.questionsBack.length ? `<h5>Questions for you</h5>${list(c.questionsBack)}` : ""}</article>`;
    }).join("");
  toolbar(out, "Distinct: asset idea check", "distinct_check");
}
RENDERERS.distinctCheck = renderChecks;

$("#check-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target;
  const out = $("#distinct-check-out");
  if (!journeyStats().keyReady) { refreshJourneyStatus(); return; }
  const proposals = ideas.filter((x) => x.description.trim());
  if (!proposals.length) { out.innerHTML = `<p class="msg error">Describe at least one idea.</p>`; return; }
  const inventories = scans.filter((s) => !s.error).map((s) => ({ name: s.name, assets: s.assets, colours: [s.themeColor, ...s.colours.map((c) => c.hex), ...s.logoColours.map((c) => c.hex)].filter(Boolean), userNotes: s.userNotes }));
  busy(form, async () => {
    const p = progress(out, ["Measuring colour clashes and checking each idea against competitors and your journey"]);
    p.step(0);
    try {
      const d = await api("distinct_check", { proposals, inventories, journey });
      if (!inventories.length) d.checks.forEach((c) => (c.collision.explanation = `No competitors scanned yet, so clashes could not be checked. ${c.collision.explanation}`));
      renderChecks(d);
      saveHistory("distinctCheck", `Distinct check: ${proposals.length} ${proposals.length === 1 ? "idea" : "ideas"}`, d);
    } catch (err) {
      p.fail(0);
      out.insertAdjacentHTML("beforeend", `<p class="msg error">${esc(err.message)}</p>`);
    } finally {
      p.stop();
    }
  });
});

// ================================================================ 4. Data finder
const ACCESS = { free: "Free", paid: "Paid", unknown: "Access unknown" };
function dataItem(f, sc) {
  return `<li><b>${esc(f.name)}</b>${f.publisher ? `, ${esc(f.publisher)}` : ""} <span class="badge ${f.access === "free" ? "medium" : "none"}">${esc(ACCESS[f.access])}</span>
    ${f.covers ? `<br>${esc(f.covers)}` : ""}${f.why ? `<br><span class="why">${esc(f.why)}</span>` : ""}
    <br><span class="hint">Where it was found:</span> ${f.links.map((l) => `${link(l.url, l.title)} ${l.ok ? `<span class="badge medium">loads</span>` : `<span class="badge none">not confirmed</span>`}`).join(" · ")} ${citeChips(f.cited, sc)}</li>`;
}
const suggestedItem = (s) => `<li><b>${esc(s.name)}</b> <span class="badge">suggested by AI</span>${s.why ? `<br><span class="why">${esc(s.why)}</span>` : ""}<br>${link(s.url, s.url)} ${s.ok ? `<span class="badge medium">loads</span>` : `<span class="badge none">could not confirm, may be dead or wrong</span>`}</li>`;
function renderData({ research: r, result: d }) {
  const out = $("#data-out");
  const sc = "data";
  let h = noticeBlock(r);
  const checkedCount = d.checked.length + d.checkedSuggested.length;
  h += `<section><h3>Checked links (${checkedCount})</h3><p class="hint">Software opened each link and it loaded. "Loads" does not prove the page holds the data: open it and check. "Where it was found" is the page that mentions the source.</p>
    ${checkedCount ? `<ol class="data-list">${d.checked.map((f) => dataItem(f, sc)).join("")}${d.checkedSuggested.map(suggestedItem).join("")}</ol>` : `<p class="hint">No links could be confirmed.</p>`}</section>`;
  const unCount = d.unconfirmed.length + d.unconfirmedSuggested.length;
  if (unCount) h += `<section><h3>Found, but the link could not be confirmed (${unCount})</h3><p class="hint">Some sites block automated checks, so these may still work. Search for the name if a link fails.</p>
    <ol class="data-list">${d.unconfirmed.map((f) => dataItem(f, sc)).join("")}${d.unconfirmedSuggested.map(suggestedItem).join("")}</ol></section>`;
  if (d.notPublic.length) h += `<section><h3>Named, but not public</h3><p class="hint">Named by AI from general knowledge. Confirm each exists before you rely on it.</p>
    <ul>${d.notPublic.map((x) => `<li><b>${esc(x.name)}</b>${x.holder ? `, held by ${esc(x.holder)}` : ""}${x.covers ? `<br>${esc(x.covers)}` : ""}${x.how ? `<br><span class="why">How to get it: ${esc(x.how)}</span>` : ""}</li>`).join("")}</ul></section>`;
  if (d.ideal.length) {
    const avail = { yes: "Likely available", partly: "Partly available", unlikely: "Unlikely to exist publicly" };
    h += `<section><h3>Data you'd ideally want</h3><p class="hint">The data that would answer your question best, and the primary research to run when it isn't available.</p>
      ${d.ideal.map((x) => `<article class="card"><h4>${esc(x.dataset)}</h4><p class="meta"><span class="badge ${x.available === "yes" ? "medium" : "none"}">${esc(avail[x.available])}</span><span class="badge cost">${esc(x.effort)} effort</span></p>
        ${x.why ? `<p class="why">${esc(x.why)}</p>` : ""}${x.method ? `<p><b>Do it yourself:</b> ${esc(x.method)}</p>` : ""}${x.ask ? `<p><b>What to ask or record:</b> ${esc(x.ask)}</p>` : ""}</article>`).join("")}</section>`;
  }
  if (d.surveyQuestions.length) h += `<section><h3>Survey questions you could run yourself</h3><ol>${d.surveyQuestions.map((q) => `<li>${esc(q)}</li>`).join("")}</ol><p class="hint">Use the survey size calculator below to plan how many responses you need.</p></section>`;
  h += evidenceSection(r, sc);
  out.innerHTML = h;
  toolbar(out, `Data finder: ${d.form.idea.slice(0, 60)}`, "data_sources");
}
RENDERERS.data = renderData;

$("#data-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const out = $("#data-out");
  const input = { idea: (fd.get("idea") || "").trim(), market: fd.get("market"), decisions: fd.get("decisions") };
  if (!input.idea) { out.innerHTML = `<p class="msg error">Describe what you are planning first.</p>`; return; }
  const useJourney = !!fd.get("useJourney") && journeyStats().hasAny;
  busy(form, async () => {
    const p = progress(out, ["Searching for data sets, portals and reports", "Organising the sources and testing every link"]);
    let step = 0;
    try {
      p.step(0);
      const r = await api("data_search", { form: input });
      step = 1;
      p.step(1);
      const result = await api("data_structure", { form: input, research: r, journey: useJourney ? journey : null, useJourney });
      const data = { research: r, result };
      renderData(data);
      saveHistory("data", `Data: ${input.idea.slice(0, 60)}`, data);
    } catch (err) {
      p.fail(step);
      out.insertAdjacentHTML("beforeend", `<p class="msg error">${esc(err.message)}</p>`);
    } finally {
      p.stop();
    }
  });
});

// Survey size: n0 = z² p(1−p) / e², then corrected for a finite population: n = n0 / (1 + (n0 − 1) / N).
function paintCalc() {
  const z = Number($("#calc-conf").value);
  const e = Number($("#calc-moe").value) / 100;
  const p = Number($("#calc-p").value) / 100;
  const N = Math.floor(Number($("#calc-pop").value));
  const out = $("#calc-out");
  if (!(e > 0 && e < 1 && p > 0 && p < 1)) { out.innerHTML = `<p class="msg error">Enter a margin of error between 1 and 20, and an expected share between 1 and 99.</p>`; return; }
  const n0 = (z * z * p * (1 - p)) / (e * e);
  const n = N > 0 ? n0 / (1 + (n0 - 1) / N) : n0;
  out.innerHTML = `<div class="metrics"><div class="metric"><b>${Math.ceil(n).toLocaleString("en-IN")}</b><span>completed responses needed</span></div></div>
    <p class="hint">Formula: n = z² × p × (1 − p) ÷ e²${N > 0 ? ", then adjusted for a population of " + N.toLocaleString("en-IN") : ""}. z = ${z}, p = ${p}, e = ${e}.
    Not everyone replies, so invite more people than this. A share of 50% gives the safest (largest) number when you don't know what to expect.</p>`;
}
["#calc-conf", "#calc-moe", "#calc-p", "#calc-pop"].forEach((s) => $(s).addEventListener("input", paintCalc));
paintCalc();

// ================================================================ 5. Competitors
compRows($("#comp-rows"), false, load("ms-comp-comps", []));
$("#comp-rows").addEventListener("input", () => store("ms-comp-comps", readComps($("#comp-rows"))));

const CATEGORY_LABEL = { launch: "Launch", promotion: "Promotion", price: "Price", partnership: "Partnership", campaign: "Campaign", expansion: "Expansion", funding: "Funding", other: "Other" };
function renderCompetitor(c, k) {
  if (c.error) return `<article class="comp-card"><h3>${esc(c.name)}</h3><p class="msg error">${esc(c.error)}</p></article>`;
  const sc = `comp${k}`;
  const b = c.brief;
  const point = (label, x) => (x ? `<p><b>${label}:</b> ${esc(x.text)} ${citeChips(x.cited, sc)}</p>` : `<p><b>${label}:</b> <span class="hint">not found in the evidence</span></p>`);
  let h = `<article class="comp-card"><h3>${esc(c.name)}${c.site ? ` <span class="hint">${esc(c.site)}</span>` : ""}</h3>${noticeBlock(c.research)}`;
  if (c.research.pageError) h += `<p class="msg warn">Website: ${esc(c.research.pageError)}</p>`;
  h += `<h4>Brief</h4>${point("Who they are", b.who)}${point("How they position themselves", b.positioning)}${point("Who they say they serve", b.audience)}`;
  if (b.claims.length) h += `<p><b>Their claims, in their words:</b></p><ul>${b.claims.map((q) => `<li>“${esc(q.text)}” ${citeChips(q.cited, sc)}</li>`).join("")}</ul>`;
  if (b.channels.length) h += `<p><b>Where they market and sell:</b> ${b.channels.map((x) => `${esc(x.channel)} ${citeChips(x.cited, sc)}`).join(" · ")}</p>`;
  h += `<h4>Momentum timeline</h4>`;
  h += c.timeline.length
    ? `<ol class="timeline">${c.timeline.map((t) => `<li><span class="when">${esc(t.date ? fmtDate(t.date) : "Date not given")}</span><span class="badge">${esc(CATEGORY_LABEL[t.category])}</span> ${esc(t.event)} ${citeChips(t.cited, sc)}</li>`).join("")}</ol>`
    : `<p class="hint">No dated moves were found in the evidence.</p>`;
  const cv = c.customerViews;
  h += `<h4>What customers say</h4>`;
  if (cv.quoteCount) {
    h += `<p class="hint">${plural(cv.quoteCount, "quote")} from ${plural(cv.sourceCount, "source")}. Every quote was checked word for word against its source. This is a small sample, not a measure of overall opinion.</p>`;
    const themes = (title, items, cls) => (items.length ? `<div class="views ${cls}"><h5>${title}</h5>${items.map((t) => `<p><b>${esc(t.theme)}</b></p><ul>${t.quotes.map((q) => `<li>“${esc(q.text)}” ${citeChips(q.cited, sc)}</li>`).join("")}</ul>`).join("")}</div>` : "");
    h += `<div class="cols">${themes("Praise", cv.praise, "praise")}${themes("Complaints", cv.complaints, "complaints")}</div>`;
  } else h += `<p class="hint">No customer quotes could be verified against their sources.</p>`;
  if (c.hypotheses.length) h += `<h4>What this might mean for you</h4><p class="hint">The AI's inference from the evidence cited, not a fact.</p><ul>${c.hypotheses.map((x) => `<li>${esc(x.text)} ${citeChips(x.basedOn, sc)}</li>`).join("")}</ul>`;
  h += evidenceSection(c.research, sc);
  return h + `</article>`;
}
function renderCompetitors(list) {
  const out = $("#comp-out");
  out.innerHTML = list.map(renderCompetitor).join("");
  toolbar(out, `Competitor snapshot: ${list.map((c) => c.name).join(", ")}`, "competitor_snapshot");
}
RENDERERS.competitor = renderCompetitors;

$("#comp-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target;
  const out = $("#comp-out");
  const comps = readComps($("#comp-rows"));
  const market = form.market.value;
  const product = form.product.value.trim() || journey.product;
  if (!comps.length) { out.innerHTML = `<p class="msg error">Enter at least one competitor's name.</p>`; return; }
  busy(form, async () => {
    const p = progress(out, comps.flatMap((c) => [`Researching ${c.name}: search, news and website`, `Writing ${c.name}'s brief and checking every quote`]));
    const results = [];
    for (const [k, c] of comps.entries()) {
      let step = k * 2;
      try {
        p.step(step);
        const r = await api("comp_research", { competitor: c, market });
        step += 1;
        p.step(step);
        const d = await api("comp_structure", { competitor: c, market, product, research: r });
        results.push({ ...d, research: r });
      } catch (err) {
        p.fail(step);
        results.push({ name: c.name, error: err.message });
      }
    }
    p.stop();
    renderCompetitors(results);
    if (results.some((c) => !c.error)) saveHistory("competitor", `Competitors: ${comps.map((c) => c.name).join(", ")}`, results);
  });
});

// ================================================================ start
showTool(location.hash.slice(1) || "journey", false);
