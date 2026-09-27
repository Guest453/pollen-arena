# 🥊 Pollen Arena

**Community vs Official.** Two models answer the same prompt blind. You vote for the better answer, then see which was the real thing — plus what each one cost, how fast it was, and how many tokens it used.

Built on [Pollinations](https://pollinations.ai). One static page, no backend, runs on GitHub Pages.

## Why

Half of the text models on `gen.pollinations.ai` are community models, and some carry the same name as an official model (`openai/gpt-6-luna` vs `community/Saauf/gpt-6-luna`). Nothing checks whether the impostor is actually as good — or how much budget it burns while you find out. Pollen Arena runs the comparison live.

The matchup list is generated from `GET /v1/models`: every community text model whose base name matches an official text model becomes a battle (17 of them today).

## BYOP — your key, your pollen

Sign in with Pollinations through OAuth (PKCE, all in the browser). The app receives a scoped key you approved, with the budget and expiry you set on the consent screen, and it never leaves your browser — held in `sessionStorage`, sent only to `gen.pollinations.ai`. Revoke it any time from your dashboard.

## Run locally

```bash
npx serve .       # or: python3 -m http.server
```

## Deploy

1. Push to a GitHub repo.
2. Settings → Pages → Source: **main branch / root**.
3. Create an **App Key** at [enter.pollinations.ai/keys](https://enter.pollinations.ai/keys), set its **Redirect URI** to your Pages URL, and paste the `pk_...` into `CLIENT_ID` in `app.js`.

Developer earnings are opt-in per App Key; that is your call in the dashboard.

## Files

- `index.html` — the arena UI
- `style.css` — dark, side-by-side layout
- `app.js` — OAuth PKCE, catalog matchups, blind streamed battles, cost/latency reveal

## Notes

- Blind by construction: the sides are swapped randomly per battle, so the labels never leak which is the community model.
- Cost is estimated from each model's published `pricing` in `/v1/models` and the usage the stream reports.
- No backend, no build step, no dependencies.
