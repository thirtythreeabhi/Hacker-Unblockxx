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

Each deployment is a snapshot. If the crawl changes, commit the updated JSONL and contests file, then redeploy. No database or authentication is required.

## Shareable questions

Questions use URLs such as:

`/?contest=10235&content=173`

The detail drawer fetches the full statement through `/api/question`, validates numeric IDs, normalizes the upstream JSON:API response, and shows a clear error for restricted or unavailable questions.
