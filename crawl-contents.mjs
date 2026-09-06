import fs from "node:fs/promises";

const API = "https://hack-api.codingblocks.com/api/v2";
const CONCURRENCY = 4;
const REQUEST_DELAY_MS = 250;
const MAX_RETRIES = 4;

const CONTESTS_FILE = "data/contests.json";
const OUTPUT_FILE = "data/contest-contents.jsonl";
const SUMMARY_FILE = "data/content-summary.json";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url);

      if (response.ok) {
        return {
          status: response.status,
          body: await response.json(),
        };
      }

      if (response.status === 429 || response.status >= 500) {
        const wait = attempt * 2000;

        console.log(
          `HTTP ${response.status}. Retry ${attempt}/${MAX_RETRIES} in ${wait}ms`,
        );

        await sleep(wait);
        continue;
      }

      return {
        status: response.status,
        body: null,
      };
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        throw error;
      }

      await sleep(attempt * 2000);
    }
  }

  throw new Error(`Failed after ${MAX_RETRIES} retries: ${url}`);
}

async function loadCompleted() {
  try {
    const text = await fs.readFile(OUTPUT_FILE, "utf8");

    return new Set(
      text
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line).contest_id),
    );
  } catch {
    return new Set();
  }
}

await fs.mkdir("data", { recursive: true });

const contests = JSON.parse(await fs.readFile(CONTESTS_FILE, "utf8"));

const contestIds = contests
  .map((contest) => contest.id ?? contest.attributes?.id)
  .filter((id) => id != null)
  .map(Number);

const completed = await loadCompleted();

const pending = contestIds.filter((contestId) => !completed.has(contestId));

console.log("Total contests:", contestIds.length);
console.log("Already completed:", completed.size);
console.log("Remaining:", pending.length);
console.log();

let cursor = 0;
let processedThisRun = 0;

async function worker(workerId) {
  while (true) {
    const index = cursor++;

    if (index >= pending.length) {
      return;
    }

    const contestId = pending[index];

    const url = `${API}/contests/${contestId}/relationships/contents`;

    try {
      const result = await fetchJson(url);

      const record = {
        contest_id: contestId,
        status: result.status,
        data: result.body?.data ?? [],
        crawled_at: new Date().toISOString(),
      };

      await fs.appendFile(OUTPUT_FILE, `${JSON.stringify(record)}\n`, "utf8");

      processedThisRun++;

      const count = record.data.length;

      console.log(
        `[${completed.size + processedThisRun}/${contestIds.length}] ` +
          `contest=${contestId} contents=${count} status=${result.status}`,
      );
    } catch (error) {
      const record = {
        contest_id: contestId,
        status: null,
        error: String(error),
        data: [],
        crawled_at: new Date().toISOString(),
      };

      await fs.appendFile(OUTPUT_FILE, `${JSON.stringify(record)}\n`, "utf8");

      console.error(
        `[worker ${workerId}] FAILED contest=${contestId}`,
        error.message,
      );
    }

    await sleep(REQUEST_DELAY_MS);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)));

console.log("\nCrawl finished. Building summary...\n");

const lines = (await fs.readFile(OUTPUT_FILE, "utf8"))
  .trim()
  .split("\n")
  .filter(Boolean);

const records = lines.map(JSON.parse);

const uniqueContentIds = new Set();
const uniqueProblemIds = new Set();

let memberships = 0;
let emptyContests = 0;
let failedContests = 0;
let malformedContents = 0;

const contentUsage = new Map();
const problemUsage = new Map();

for (const record of records) {
  if (record.status !== 200) {
    failedContests++;
    continue;
  }

  if (!record.data?.length) {
    emptyContests++;
  }

  for (const content of record.data ?? []) {
    memberships++;

    const contentId = content.id ?? content.attributes?.id;

    const problemId = content.relationships?.problem?.data?.id;

    if (contentId == null) {
      malformedContents++;
      continue;
    }

    const contentKey = String(contentId);

    uniqueContentIds.add(contentKey);

    contentUsage.set(contentKey, (contentUsage.get(contentKey) ?? 0) + 1);

    if (problemId != null) {
      const problemKey = String(problemId);

      uniqueProblemIds.add(problemKey);

      problemUsage.set(problemKey, (problemUsage.get(problemKey) ?? 0) + 1);
    }
  }
}

const mostReusedContents = [...contentUsage.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 50)
  .map(([content_id, contest_count]) => ({
    content_id,
    contest_count,
  }));

const mostReusedProblems = [...problemUsage.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 50)
  .map(([problem_id, contest_count]) => ({
    problem_id,
    contest_count,
  }));

const summary = {
  contests: {
    total: records.length,
    successful: records.length - failedContests,
    failed: failedContests,
    empty: emptyContests,
  },

  memberships,

  unique_contents: uniqueContentIds.size,
  unique_problems: uniqueProblemIds.size,

  malformed_contents: malformedContents,

  average_contents_per_contest: records.length
    ? memberships / records.length
    : 0,

  most_reused_contents: mostReusedContents,
  most_reused_problems: mostReusedProblems,
};

await fs.writeFile(SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");

await fs.writeFile(
  "data/content-ids.json",
  JSON.stringify(
    [...uniqueContentIds].sort((a, b) => Number(a) - Number(b)),
    null,
    2,
  ),
  "utf8",
);

await fs.writeFile(
  "data/problem-ids.json",
  JSON.stringify(
    [...uniqueProblemIds].sort((a, b) => Number(a) - Number(b)),
    null,
    2,
  ),
  "utf8",
);

console.log("--- Summary ---");
console.log("Contests:", records.length);
console.log("Failed contests:", failedContests);
console.log("Empty contests:", emptyContests);
console.log("Contest-content memberships:", memberships);
console.log("Unique content IDs:", uniqueContentIds.size);
console.log("Unique problem IDs:", uniqueProblemIds.size);
console.log("Malformed contents:", malformedContents);

console.log("\nSaved:");
console.log("data/contest-contents.jsonl");
console.log("data/content-summary.json");
console.log("data/content-ids.json");
console.log("data/problem-ids.json");
