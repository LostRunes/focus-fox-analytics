# Focus Fox Analytics Dashboard

Static dashboard (HTML/CSS/JS) that reads app analytics from Supabase
(`v_supabase_analytics`) and archived events from Neon (`v_neon_analytics`).

## Run locally
1. Copy `env.example.js` to `env.js` and fill in the Supabase URL and anon key.
2. Serve the folder, e.g. `npx serve .`, and open the printed URL.

## Deploy on Vercel
1. Import this repo in Vercel (Framework preset: **Other**).
2. Add environment variables `SUPABASE_2_URL` and `SUPABASE_2_KEY`.
3. Deploy. `vercel.json` runs `scripts/generate-env.js` to create `env.js` at build time.
