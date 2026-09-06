import fs from "node:fs/promises";

const CONTESTS_FILE = "data/contests.json";
const CONTENTS_FILE = "data/contest-contents.jsonl";
const ENRICHMENT_FILE = "data/contest-enrichment.jsonl";
const OUTPUT_FILE = "public/data/index.json";

function asId(value) {
  if (value === null || value === undefined || value === "") return null;
  const stringValue = String(value);
  return /^\d+$/.test(stringValue) ? stringValue : null;
}

function contestIdOf(contest) {
  return asId(contest?.id ?? contest?.attributes?.id);
}

function normalizeContent(item) {
  const attributes = item?.attributes ?? {};
  const problemId = asId(item?.relationships?.problem?.data?.id);
  const contentId = asId(item?.id ?? attributes.id);

  if (!contentId) return null;

  return {
    contentId,
    problemId,
    name: typeof attributes.name === "string" ? attributes.name.trim() : "",
    difficulty:
      typeof attributes.difficulty === "number" ? attributes.difficulty : null,
    type: typeof attributes.type === "string" ? attributes.type : null,
    verified: attributes.verified === true,
  };
}

const contestsSource = JSON.parse(await fs.readFile(CONTESTS_FILE, "utf8"));
const contests = Array.isArray(contestsSource)
  ? contestsSource
  : contestsSource?.data ?? [];

const contestMap = new Map();
for (const contest of contests) {
  const id = contestIdOf(contest);
  if (!id) continue;

  const attributes = contest?.attributes ?? {};
  contestMap.set(id, {
    contestId: id,
    contestName:
      typeof attributes.name === "string" ? attributes.name : "Unknown contest",
    status: null,
    contentCount: 0,
    contents: [],
  });
}

const contentsText = await fs.readFile(CONTENTS_FILE, "utf8");
const recordsByContest = new Map();
let malformedLines = 0;

for (const line of contentsText.split(/\r?\n/)) {
  if (!line.trim()) continue;

  try {
    const record = JSON.parse(line);
    const contestId = asId(record?.contest_id);
    if (!contestId) {
      malformedLines++;
      continue;
    }

    // The crawler appends records. Keeping the last complete record also makes
    // this safe if a future crawl retries a contest.
    recordsByContest.set(contestId, record);
  } catch {
    // A crawler can leave an incomplete final line while it is being appended.
    malformedLines++;
  }
}

for (const [contestId, record] of recordsByContest) {
  if (!contestMap.has(contestId)) {
    contestMap.set(contestId, {
      contestId,
      contestName: "Unknown contest",
      status: null,
      contentCount: 0,
      contents: [],
    });
  }

  const target = contestMap.get(contestId);
  target.status = typeof record.status === "number" ? record.status : null;
  target.contents = (Array.isArray(record.data) ? record.data : [])
    .map(normalizeContent)
    .filter(Boolean);
  target.contentCount = target.contents.length;
}

const indexedContests = [...contestMap.values()].sort(
  (a, b) => Number(b.contestId) - Number(a.contestId),
);

const enrichmentByContest = new Map();
try {
  const enrichmentText = await fs.readFile(ENRICHMENT_FILE, "utf8");
  for (const line of enrichmentText.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      const contestId = asId(record?.contestId);
      if (contestId) enrichmentByContest.set(contestId, record);
    } catch {
      // A partial final enrichment line should not prevent the index build.
    }
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const enrichmentFields = [
  "description", "kind", "topics", "course", "batch", "instructor", "institution", "year",
  "difficultyProfile", "languages", "tags", "confidence", "sourceQuality", "model", "generatedAt",
];
for (const contest of indexedContests) {
  const enrichment = enrichmentByContest.get(contest.contestId);
  if (!enrichment) continue;
  for (const field of enrichmentFields) {
    if (Object.hasOwn(enrichment, field)) contest[field] = enrichment[field];
  }
}
const successful = indexedContests.filter((contest) => contest.status === 200);
const denied = indexedContests.filter((contest) => contest.status === 403);
const allContents = successful.flatMap((contest) => contest.contents);

const index = {
  generatedAt: new Date().toISOString(),
  stats: {
    contests: indexedContests.length,
    accessibleContests: successful.length,
    deniedContests: denied.length,
    memberships: allContents.length,
    uniqueContents: new Set(allContents.map((content) => content.contentId)).size,
    uniqueProblems: new Set(
      allContents.map((content) => content.problemId).filter(Boolean),
    ).size,
    malformedLines,
  },
  contests: indexedContests,
};

await fs.mkdir("public/data", { recursive: true });
await fs.writeFile(OUTPUT_FILE, JSON.stringify(index), "utf8");

console.log(
  `Built ${OUTPUT_FILE}: ${index.stats.contests} contests, ` +
    `${index.stats.memberships} memberships, ${enrichmentByContest.size} enrichments, ` +
    `${malformedLines} ignored malformed lines`,
);
