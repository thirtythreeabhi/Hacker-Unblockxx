# Problem search foundation

The canonical corpus is built from the trusted HackerBlocks content endpoint. It stores one deduplicated record per problem in `data/problem-corpus.jsonl`; it intentionally excludes explanations, solution stubs, and hidden implementation material.

## Corpus commands

```powershell
node scripts/build-problem-corpus.mjs --limit 20
node scripts/build-problem-corpus.mjs --problem 209
node scripts/build-problem-corpus.mjs --problem 209 --force
```

The builder tolerates a truncated final JSONL line, persists after every completed fetch, retries transient source failures, and never replaces a valid record unless `--force` is supplied. Use `CORPUS_CONCURRENCY`, `CORPUS_REQUEST_DELAY_MS`, `CORPUS_REQUEST_TIMEOUT_MS`, and `CORPUS_MAX_RETRIES` to tune it.

## Embeddings

The embedding path is separate from the generative Gemini model pool. It defaults to `GEMINI_EMBEDDING_MODEL=gemini-embedding-001` and `GEMINI_EMBEDDING_DIMENSIONS=768`. The script checks the returned vector length before any database write.

The embedding script requires a server-only `SUPABASE_SERVICE_ROLE_KEY`; it does not weaken RLS or use the publishable key for writes. Load local environment variables explicitly:

```powershell
node --env-file=.env.local scripts/embed-problems.mjs --limit 3
npm run embed:problems -- --limit 3
node --env-file=.env.local scripts/embed-problems.mjs --problem 209 --force
```

The migration must be applied before embedding. It creates the shared `problem_search` table, a 768-dimensional pgvector column, public read access, and the `match_problems` cosine-similarity RPC. Browser clients receive no insert, update, or delete grants.

For a new shell, set these server/local variables without committing them:

```text
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
GEMINI_API_KEYS=key1,key2
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
GEMINI_EMBEDDING_DIMENSIONS=768
```

The embedding job skips a row when both `source_hash` and `embedding_model` are unchanged, so it can be safely resumed. `EMBEDDING_CONCURRENCY` controls local workers.

## Semantic discovery

The browser's Semantic mode submits only the query text and supported filters to `GET /api/search/problems`; provider keys and model configuration remain server-side. The route embeds queries with `RETRIEVAL_QUERY`, calls `match_problems`, attaches a known contest/content appearance, and returns ranked results. Query embeddings are normalized and cached in memory for five minutes. Related, Similar easier, and Similar harder use the stored current-problem vector and never call the generative model.

Potential near-duplicates can be reviewed with:

```powershell
node --env-file=.env.local scripts/find-near-duplicates.mjs
```

This writes `data/problem-near-duplicates.json` using a conservative threshold (default `0.94`). It reports candidates only; it never merges or deletes records.
