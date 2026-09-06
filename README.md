# HackerBlocks Browser

A local and Vercel-friendly browser for the crawled HackerBlocks contests and questions.

## Local development

Install dependencies, build a compact snapshot index from the crawler output, and start the app:

```bash
npm install
npm run build:index
npm run dev
```

Open `http://localhost:3000`. The index step reads `data/contests.json` and `data/contest-contents.jsonl`; it ignores blank lines and an incomplete final JSONL line, so it is safe to run while a crawler is appending.

## Accounts and progress

Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL` plus `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The browser key is intentionally public; never add a Supabase service-role/secret key. Run the SQL in `supabase/migrations/20260907000000_create_problem_progress.sql` in the Supabase SQL Editor, then turn off **Authentication → Providers → Email → Confirm email** so signup creates an immediately usable session.

Progress is keyed by HackerBlocks `problemId` and falls back to `contentId` when no problem ID exists. Row Level Security restricts every progress operation to the signed-in user.

## AI practice tools

The question drawer includes on-demand Clean, Boilerplate, Approaches, Hints, Tests, Complexity, Explain simply, and deterministic Copy AI context actions. Run `supabase/migrations/20260907010000_create_ai_problem_artifacts.sql` after the progress migration. Add `SUPABASE_SERVICE_ROLE_KEY` only to server/Vercel environment variables; it is used solely by the validated artifact write path and must never be exposed to the browser. Gemini keys remain server-only in `GEMINI_API_KEYS`.

## Local contest enrichment

`npm run enrich:contests -- --limit 20` runs a conservative, resumable Gemini enrichment sample. Set `GEMINI_API_KEYS` and `GEMINI_MODELS` to comma-separated values in `.env.local`; optional settings are `GEMINI_BATCH_SIZE`, `GEMINI_CONCURRENCY`, `GEMINI_REQUEST_DELAY_MS`, `GEMINI_REQUEST_TIMEOUT_MS`, and `GEMINI_MAX_RETRIES`. Target one contest with `npm run enrich:contests -- --contest 10235`, or run all pending contests with `npm run enrich:contests`. Add `--force` with a target or limit to deliberately regenerate existing records; regenerated JSONL records are appended and the latest record wins when the index is built. The script writes only `data/contest-enrichment.jsonl` and `data/contest-enrichment-failures.jsonl`; raw crawler files are never changed.

The generated enrichment file includes independent `kind` and `domain` fields, exhaustive `topics`, up to four `primaryTopics`, conservative `course`/`batch`/`location`/`instructor`/`institution` fields, deterministic `difficultyProfile`, and calibrated confidence. `npm run build:index` merges valid enrichment records into `public/data/index.json` when present and continues normally when it is absent.

To verify a production build locally:

```bash
npm run build
npm run start
```

`npm run vercel-build` runs the index generation followed by `next build` automatically. Full question details are fetched server-side only when a question is opened and cached for 24 hours.

## Vercel deployment

1. Push this project to a Git provider, including the `data/` files needed for the snapshot.
2. Import the repository in Vercel.
3. Keep the framework preset as **Next.js** and leave the build command as `npm run vercel-build` (or set it explicitly in Project Settings → Build & Development Settings).
4. Deploy. Vercel generates `public/data/index.json` from the data committed in that deployment.

Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` under Vercel Project Settings → Environment Variables for every environment you deploy. In Supabase Authentication → URL Configuration, set Site URL to the deployed Vercel URL. Email/password auth with confirmation disabled does not need an OAuth redirect URL.

Each deployment is a snapshot. If the crawl changes, commit the updated JSONL and contests file, then redeploy. No database or authentication is required.

## Shareable questions

Questions use URLs such as:

`/?contest=10235&content=173`

The detail drawer fetches the full statement through `/api/question`, validates numeric IDs, normalizes the upstream JSON:API response, and shows a clear error for restricted or unavailable questions.
