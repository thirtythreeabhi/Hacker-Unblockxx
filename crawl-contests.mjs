import fs from "node:fs/promises";

const BASE_URL = "https://hack-api.codingblocks.com/api/v2/contests";
const LIMIT = 100;
const DELAY_MS = 250;

const contests = [];
let offset = 0;
let page = 1;
let apiCount = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

while (true) {
  const url =
    `${BASE_URL}?page[limit]=${LIMIT}` + `&page[offset]=${offset}` + `&sort=id`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const body = await response.json();
  const pagination = body.meta.pagination;

  apiCount ??= pagination.count;

  console.log(`Page ${page}: ${body.data.length} records | offset=${offset}`);

  contests.push(...body.data);

  if (pagination.nextOffset == null) {
    break;
  }

  offset = pagination.nextOffset;
  page++;

  await sleep(DELAY_MS);
}

const effectiveIds = contests
  .map((contest) => contest.id ?? contest.attributes?.id)
  .filter((id) => id != null)
  .map(Number);

const uniqueIds = new Set(effectiveIds);

const missingTopLevelId = contests.filter((contest) => contest.id == null);

const missingAttributeId = contests.filter(
  (contest) => contest.attributes?.id == null,
);

const mismatchedIds = contests.filter(
  (contest) =>
    contest.id != null &&
    contest.attributes?.id != null &&
    Number(contest.id) !== Number(contest.attributes.id),
);

await fs.mkdir("data", { recursive: true });

await fs.writeFile(
  "data/contests.json",
  JSON.stringify(contests, null, 2),
  "utf8",
);

console.log("\n--- Crawl summary ---");
console.log("API-reported count:", apiCount);
console.log("Records downloaded:", contests.length);
console.log("Unique effective IDs:", uniqueIds.size);
console.log("Duplicate IDs:", effectiveIds.length - uniqueIds.size);
console.log("Missing top-level id:", missingTopLevelId.length);
console.log("Missing attributes.id:", missingAttributeId.length);
console.log("Mismatched IDs:", mismatchedIds.length);
console.log("Minimum ID:", Math.min(...effectiveIds));
console.log("Maximum ID:", Math.max(...effectiveIds));
console.log("\nSaved to data/contests.json");
