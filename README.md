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

## Search, recommendations, and tutor

The app has three complementary problem experiences:

- Semantic search embeds a submitted query and calls the bounded `match_problems` RPC. It does not search on every keystroke, and related/easier/harder results exclude the current problem.
- Practice next uses deterministic vector similarity, difficulty progression, topics, bookmarks, completion state, rotation, and near-duplicate filtering. It never calls Gemini to rank or explain recommendations.
- Ask HackerBlocks has a current-problem mode and a corpus-search mode. The first uses only trusted statement fields; the second retrieves at most eight canonical vector matches before calling Gemini. Chat is session-local, and references come only from retrieved rows.

The shared Gemini executor handles model/key fallback, bounded retries, timeouts, transient HTTP failures, JSON parsing, and artifact validation. Generated artifacts are shared by problem/source hash through `ai_problem_artifacts`; tutor conversations are not persisted.

## Problem corpus and embeddings

Build or resume the canonical, deduplicated problem corpus. The job persists after each successful fetch, skips existing records, preserves inaccessible content as failures, and never bypasses the HackerBlocks source:

```bash
node --env-file=.env.local scripts/build-problem-corpus.mjs
node --env-file=.env.local scripts/build-problem-corpus.mjs --problem 209 --force
```

Apply `supabase/migrations/20260907020000_create_problem_search.sql`, then resume the server-side embedding backfill. It skips unchanged source hashes and writes through the service-role key only:

```bash
node --env-file=.env.local scripts/embed-problems.mjs
node --env-file=.env.local scripts/embed-problems.mjs --problem 209 --force
node --env-file=.env.local scripts/find-near-duplicates.mjs
```

The default embedding model is `gemini-embedding-001` with 768 dimensions. The near-duplicate report is advisory only; no records are merged or deleted.

## Supabase setup and environment

Run the migrations in timestamp order:

```text
supabase/migrations/20260907000000_create_problem_progress.sql
supabase/migrations/20260907010000_create_ai_problem_artifacts.sql
supabase/migrations/20260907020000_create_problem_search.sql
```

Local `.env.local` needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `GEMINI_API_KEYS`, and `GEMINI_MODELS`. Corpus embedding also needs the server-only `SUPABASE_SERVICE_ROLE_KEY`. Optional controls include `GEMINI_EMBEDDING_MODEL`, `GEMINI_EMBEDDING_DIMENSIONS`, embedding timeout/retry settings, corpus concurrency/delay settings, and `GEMINI_REQUEST_TIMEOUT_MS`/`GEMINI_INTERACTIVE_RETRIES`. Never commit `.env.local`, service-role keys, passwords, or provider keys.

## Resume commands

All long-running data jobs are resumable:

```bash
npm run build:index
node --env-file=.env.local scripts/build-problem-corpus.mjs
node --env-file=.env.local scripts/embed-problems.mjs
node --env-file=.env.local scripts/find-near-duplicates.mjs
node --env-file=.env.local scripts/enrich-contests.mjs --limit 20
```

Use `--force` only with an explicit problem/contest target when regenerating existing data. Run `npm run build` for production validation.

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

For authenticated progress, shared AI artifacts, semantic search, recommendations, and Ask HackerBlocks, also configure server-side `GEMINI_API_KEYS`, `GEMINI_MODELS`, and `SUPABASE_SERVICE_ROLE_KEY` in Vercel. Apply all three Supabase migrations before enabling those features. Keep the service-role key out of `NEXT_PUBLIC_*` variables. Vercel uses `npm run vercel-build`, which rebuilds the snapshot index before `next build`.

Each deployment is a snapshot. If the crawl changes, commit the updated JSONL and contests file, then redeploy. The public browser can run without database access, but authenticated progress and AI features require the configuration above.

## Shareable questions

Questions use URLs such as:

`/?contest=10235&content=173`

The detail drawer fetches the full statement through `/api/question`, validates numeric IDs, normalizes the upstream JSON:API response, and shows a clear error for restricted or unavailable questions.
