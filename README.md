# Marketing Studio (Vercel version)

- `public/` the website (index.html = structure, style.css = look, app.js = behaviour)
- `api/ai.js` the server function the AI tools call
- `lib/` AI prompts (`prompts.js`), Gemini connection (`gemini.js`), website and news reader (`scrape.js`)

Environment variables (set in Vercel, never in files):
- `GEMINI_API_KEY` required
- `GEMINI_MODEL` optional, default gemini-3.8-flash
- `DAILY_LIMIT` optional, default 300 AI calls per day
- `IP_LIMIT` optional, default 25 AI calls per visitor per hour
