# Marketing Studio

Marketing tools that show their working. Live at https://vercel-marketing-studio-mjs9.vercel.app/

| Tab | What it does |
|---|---|
| **Journey** | A guided, stage-by-stage purchase journey with "how do you know" tags, gaps, buying situations and AI follow-up questions. Saved in the browser and used by the other tools. |
| **GTM strategy** | Searches Google and Google News for recent evidence, then builds recommendations, bigger bets, journey touchpoints, tests and an execution plan. Every claim cites evidence (E1, E2, ...). Ideas without evidence are labelled hypotheses. Includes the "Sharp principles, as read by Sidharth" check. |
| **Distinct** | Step 1 documents competitors' distinctive assets: colours measured from their website code, logos and images described by AI, and slogans, sounds, characters and packaging found by search. Step 2 checks your own asset ideas for clashes, journey fit, memory links and how to test them. |
| **Data finder** | Data sets with every link tested, sources that are not public, the data you'd ideally want, primary research to run instead, and a survey size calculator. |
| **Competitors** | For up to three rivals: a brief, a dated timeline of moves and what customers say. Quotes are kept only if they appear word for word in their source. |

Also: progress steps while the AI works, saved history (browser only), print or save as PDF, Markdown download, and link previews.

## How it stays honest
- The AI never answers from memory about markets or competitors. A research step collects evidence from Google Search (Gemini grounding) and Google News, and each piece gets an id.
- The code checks every AI reply: citations must point at real evidence, quotes must appear in the cited evidence, dates must come from the evidence, and links are opened to see if they load.
- If Google Search grounding is not available for the key, the tools say so and fall back to news headlines and pages read directly.

## Files
- `public/` the page: `index.html`, `style.css`, `app.js`, `shared.js` (lists shared with the server, including the Sharp principles), `og.png` (link preview image)
- `api/ai.js` the one server function: every tool, and the checks on the AI's replies
- `lib/gemini.js` talks to Gemini (time limits, backup models, Google Search)
- `lib/research.js` gathers and numbers the evidence
- `lib/prompts.js` all AI instructions
- `lib/scrape.js` reads web pages safely, tests links, measures colours
- `lib/validate.js` small cleaning and checking helpers
- `vercel.json` lets the server function run for up to 300 seconds (the Hobby plan maximum)

## Settings (Vercel > Project > Settings > Environment Variables)
| Name | Needed? | Meaning |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Your Google AI Studio key. Never put it in the code. |
| `GEMINI_MODEL` | No | Main model (default `gemini-3.8-flash`) |
| `GEMINI_FALLBACK_MODELS` | No | Backups when busy (default `gemini-3.5-flash-lite,gemini-3.6-flash`) |
| `GEMINI_THINKING` | No | `minimal`, `low` (default), `medium`, `high` or `off` |
| `GEMINI_TIMEOUT_SECONDS` | No | Longest wait for one AI answer (default 200, max 280) |
| `IP_LIMIT` / `DAILY_LIMIT` | No | AI calls per visitor per hour (default 80) and per day for the site (default 600) |

After changing a setting, redeploy (Deployments > ... > Redeploy).
