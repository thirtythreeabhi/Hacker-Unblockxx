import fs from "node:fs/promises";

const CONTESTS_FILE = "data/contests.json";
const CONTENTS_FILE = "data/contest-contents.jsonl";
const OUTPUT_FILE = "data/contest-enrichment.jsonl";
const FAILURES_FILE = "data/contest-enrichment-failures.jsonl";
const API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);
const KINDS = ["assignment", "practice", "test", "exam", "hackathon", "challenge", "admission", "interview", "course", "unknown"];
const DIFFICULTIES = ["easy", "easy-medium", "medium", "medium-hard", "hard", "mixed", "unknown"];
const TOPICS = new Set(["arrays", "strings", "sorting", "binary-search", "two-pointers", "sliding-window", "recursion", "backtracking", "linked-list", "stack", "queue", "hashing", "heap", "trees", "bst", "graphs", "greedy", "dynamic-programming", "bit-manipulation", "number-theory", "math", "patterns", "tries", "segment-tree", "competitive-programming", "aptitude", "reasoning", "sql", "web-development", "other"]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const asString = (value) => value === null || value === undefined ? null : String(value);
const asId = (value) => /^\d+$/.test(String(value ?? "")) ? String(value) : null;

function parseArgs(argv) {
  const args = { limit: null, contests: null };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--limit") args.limit = Number.parseInt(argv[++index], 10);
    if (argv[index] === "--contest") args.contests = (argv[++index] ?? "").split(",").map(asId).filter(Boolean);
  }
  if (args.limit !== null && (!Number.isInteger(args.limit) || args.limit < 1)) throw new Error("--limit must be a positive integer");
  return args;
}

async function readJsonl(file) {
  try {
    const text = await fs.readFile(file, "utf8");
    return text.split(/\r?\n/).filter((line) => line.trim()).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function contestIdOf(contest) {
  return asId(contest?.id ?? contest?.attributes?.id);
}

function questionContext(record) {
  if (record?.status !== 200 || !Array.isArray(record.data)) return [];
  return record.data.map((item) => ({
    name: String(item?.attributes?.name ?? "Untitled question").trim().slice(0, 240),
    difficulty: [1, 2, 3].includes(item?.attributes?.difficulty) ? item.attributes.difficulty : null,
  }));
}

function difficultyProfile(questions) {
  const levels = [...new Set(questions.map((question) => question.difficulty).filter(Boolean))].sort();
  if (levels.length === 0) return "unknown";
  if (levels.length === 1) return levels[0] === 1 ? "easy" : levels[0] === 2 ? "medium" : "hard";
  if (levels.every((level) => level <= 2)) return "easy-medium";
  if (levels.every((level) => level >= 2)) return "medium-hard";
  return "mixed";
}

function languagesOf(attributes) {
  return Array.isArray(attributes?.["allowed-languages"])
    ? [...new Set(attributes["allowed-languages"].map((value) => String(value).trim().toLowerCase()).filter(Boolean))]
    : [];
}

function compactContest(contest, contentsByContest) {
  const attributes = contest?.attributes ?? {};
  const questions = questionContext(contentsByContest.get(contestIdOf(contest)));
  return {
    id: Number(contestIdOf(contest)),
    name: String(attributes.name ?? "").trim(),
    originalDescription: String(attributes.description ?? "").trim().slice(0, 1600),
    contestType: asString(attributes["contest-type"]),
    startTime: asString(attributes["start-time"]),
    languages: languagesOf(attributes),
    questions,
    difficultySummary: { easy: questions.filter((question) => question.difficulty === 1).length, medium: questions.filter((question) => question.difficulty === 2).length, hard: questions.filter((question) => question.difficulty === 3).length },
  };
}

function schema() {
  return {
    type: "ARRAY",
    items: {
      type: "OBJECT",
      properties: {
        contestId: { type: "STRING" }, description: { type: "STRING" }, kind: { type: "STRING", enum: KINDS }, topics: { type: "ARRAY", items: { type: "STRING" } }, course: { type: "STRING", nullable: true }, batch: { type: "STRING", nullable: true }, instructor: { type: "STRING", nullable: true }, institution: { type: "STRING", nullable: true }, difficultyProfile: { type: "STRING", enum: DIFFICULTIES }, tags: { type: "ARRAY", items: { type: "STRING" } }, confidence: { type: "NUMBER" },
      },
      required: ["contestId", "description", "kind", "topics", "course", "batch", "instructor", "institution", "difficultyProfile", "tags", "confidence"],
    },
  };
}

function promptFor(batch) {
  return `You are enriching HackerBlocks contest metadata. Return ONLY a JSON array with exactly one object for every supplied contest, using the supplied contestId. Ground every field only in the provided metadata and question titles/difficulties. Never infer an instructor, institution, course, batch, or topic without evidence: use null or unknown. Keep descriptions useful and short (1-2 sentences), and do not merely repeat the contest name. Normalize DSA topics to the vocabulary in this instruction. confidence must be between 0 and 1.\n\nAllowed kinds: ${KINDS.join(", ")}\nAllowed difficulty profiles: ${DIFFICULTIES.join(", ")}\nPreferred topics: ${[...TOPICS].join(", ")}\n\nInput contests:\n${JSON.stringify(batch)}`;
}

function extractText(body) {
  const parts = body?.candidates?.[0]?.content?.parts ?? [];
  return parts.map((part) => part?.text ?? "").join("").trim();
}

function parseModelArray(text) {
  const withoutFence = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed = JSON.parse(withoutFence);
  if (!Array.isArray(parsed)) throw new Error("Gemini returned a non-array response");
  return parsed;
}

function normalizeList(values, vocabulary = null) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => String(value).trim().toLowerCase()).filter((value) => value && (!vocabulary || vocabulary.has(value))))];
}

function deterministicYear(compact) {
  const year = compact.startTime ? new Date(compact.startTime).getUTCFullYear() : NaN;
  return Number.isInteger(year) && year >= 1970 && year <= 2200 ? year : null;
}

function normalizeResult(raw, compact, model) {
  if (!raw || !asId(raw.contestId) || asId(raw.contestId) !== String(compact.id)) throw new Error(`Response contained an invalid contestId for ${compact.id}`);
  const topics = normalizeList(raw.topics, TOPICS);
  const kind = KINDS.includes(raw.kind) ? raw.kind : "unknown";
  // Difficulty is derived from the source question values, never from Gemini.
  // This remains unknown when the contest has no usable 1/2/3 values.
  const normalizedDifficulty = difficultyProfile(compact.questions);
  const languages = compact.languages;
  const tags = normalizeList([...(Array.isArray(raw.tags) ? raw.tags : []), ...topics, kind, ...languages]);
  const confidence = Number(raw.confidence);
  return {
    contestId: String(compact.id),
    description: typeof raw.description === "string" ? raw.description.trim().slice(0, 600) : "",
    kind,
    topics,
    course: typeof raw.course === "string" && raw.course.trim() ? raw.course.trim() : null,
    batch: typeof raw.batch === "string" && raw.batch.trim() ? raw.batch.trim() : null,
    instructor: typeof raw.instructor === "string" && raw.instructor.trim() ? raw.instructor.trim() : null,
    institution: typeof raw.institution === "string" && raw.institution.trim() ? raw.institution.trim() : null,
    year: deterministicYear(compact),
    difficultyProfile: normalizedDifficulty,
    languages,
    tags,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    sourceQuality: compact.questions.length > 0 ? "metadata+questions" : "metadata-only",
    model,
    generatedAt: new Date().toISOString(),
  };
}

async function requestBatch(batch, key, model, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_ROOT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: promptFor(batch) }] }], generationConfig: { temperature: 0.1, responseMimeType: "application/json", responseSchema: schema() } }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(`Gemini request failed with HTTP ${response.status}`);
      error.transient = TRANSIENT_STATUS.has(response.status);
      throw error;
    }
    return parseModelArray(extractText(body));
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const keys = (process.env.GEMINI_API_KEYS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const models = (process.env.GEMINI_MODELS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (keys.length === 0 || models.length === 0) throw new Error("Set GEMINI_API_KEYS and GEMINI_MODELS as comma-separated environment variables.");

  const batchSize = Math.max(1, Number.parseInt(process.env.GEMINI_BATCH_SIZE ?? "10", 10) || 10);
  const delayMs = Math.max(0, Number.parseInt(process.env.GEMINI_REQUEST_DELAY_MS ?? "1200", 10) || 0);
  const timeoutMs = Math.max(5000, Number.parseInt(process.env.GEMINI_REQUEST_TIMEOUT_MS ?? "90000", 10) || 90000);
  const maxRetries = Math.max(2, Number.parseInt(process.env.GEMINI_MAX_RETRIES ?? "4", 10) || 4);
  const debug = process.env.DEBUG === "1";
  const contestsSource = JSON.parse(await fs.readFile(CONTESTS_FILE, "utf8"));
  const contests = (Array.isArray(contestsSource) ? contestsSource : contestsSource?.data ?? []).filter((contest) => contestIdOf(contest));
  const contentLines = await fs.readFile(CONTENTS_FILE, "utf8");
  const contentsByContest = new Map();
  for (const line of contentLines.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { const record = JSON.parse(line); const id = asId(record?.contest_id); if (id) contentsByContest.set(id, record); } catch { /* tolerate an incomplete final line */ }
  }
  const existing = await readJsonl(OUTPUT_FILE);
  const completedIds = new Set(existing.map((record) => asId(record?.contestId)).filter(Boolean));
  let pending = contests.filter((contest) => !completedIds.has(contestIdOf(contest)));
  if (args.contests) pending = pending.filter((contest) => args.contests.includes(contestIdOf(contest)));
  if (args.limit !== null) pending = pending.slice(0, args.limit);

  await fs.mkdir("data", { recursive: true });
  let completed = 0; let requests = 0; let retries = 0; let failedBatches = 0; let poolIndex = 0;
  console.log(`Enriching ${pending.length} pending contest(s); batch size ${batchSize}; ${keys.length} key(s), ${models.length} model(s)`);

  async function processBatch(batch) {
    const compact = batch.map((contest) => compactContest(contest, contentsByContest));
    let lastError = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const key = keys[poolIndex % keys.length];
      const model = models[poolIndex % models.length];
      poolIndex++;
      requests++;
      try {
        const rawResults = await requestBatch(compact, key, model, timeoutMs);
        if (rawResults.length !== batch.length) throw new Error(`Expected ${batch.length} results but received ${rawResults.length}`);
        const byId = new Map(rawResults.map((result) => [asId(result?.contestId), result]));
        if (byId.size !== batch.length || compact.some((item) => !byId.has(String(item.id)))) throw new Error("Gemini response did not contain exactly the requested contest IDs");
        const normalized = compact.map((item) => normalizeResult(byId.get(String(item.id)), item, model));
        await fs.appendFile(OUTPUT_FILE, normalized.map((record) => `${JSON.stringify(record)}\n`).join(""), "utf8");
        completed += normalized.length;
        const last = normalized[normalized.length - 1];
        console.log(`[${completed}/${pending.length}] enriched contest ${last.contestId} model=${model} topics=${last.topics.join(",") || "none"}`);
        return;
      } catch (error) {
        lastError = error;
        const transient = error?.transient || error?.name === "AbortError" || /JSON|response|network|fetch/i.test(error?.message ?? "");
        if (!transient && attempt >= 1) break;
        if (attempt < maxRetries - 1) {
          retries++;
          const waitMs = Math.min(60000, 2000 * 2 ** attempt);
          if (debug) console.log(`retrying batch of ${batch.length} after ${waitMs}ms`);
          await sleep(waitMs);
        }
      }
    }

    if (batch.length > 1) {
      const midpoint = Math.ceil(batch.length / 2);
      await processBatch(batch.slice(0, midpoint));
      await processBatch(batch.slice(midpoint));
      return;
    }

    failedBatches++;
    await fs.appendFile(FAILURES_FILE, `${JSON.stringify({ contestId: contestIdOf(batch[0]), error: lastError?.message ?? "unknown error", failedAt: new Date().toISOString() })}\n`, "utf8");
    console.error(`Failed contest ${contestIdOf(batch[0])}; it remains pending for a later run.`);
  }

  for (let index = 0; index < pending.length; index += batchSize) {
    await processBatch(pending.slice(index, index + batchSize));
    if (index + batchSize < pending.length) await sleep(delayMs);
  }
  console.log(`Done: completed=${completed} remaining=${pending.length - completed} requests=${requests} retries=${retries} failed batches=${failedBatches}`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
