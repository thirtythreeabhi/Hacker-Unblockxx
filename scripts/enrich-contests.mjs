import fs from "node:fs/promises";

const CONTESTS_FILE = "data/contests.json";
const CONTENTS_FILE = "data/contest-contents.jsonl";
const OUTPUT_FILE = "data/contest-enrichment.jsonl";
const FAILURES_FILE = "data/contest-enrichment-failures.jsonl";
const API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);
const KINDS = ["assignment", "practice", "test", "exam", "hackathon", "challenge", "admission", "interview", "course", "unknown"];
const DOMAINS = ["dsa", "programming-basics", "competitive-programming", "web-development", "sql", "aptitude", "reasoning", "mixed", "other", "unknown"];
const DIFFICULTIES = ["easy", "easy-medium", "medium", "medium-hard", "hard", "mixed", "unknown"];
const TOPICS = new Set(["arrays", "strings", "sorting", "binary-search", "two-pointers", "sliding-window", "recursion", "backtracking", "linked-list", "stack", "queue", "hashing", "heap", "trees", "bst", "graphs", "greedy", "dynamic-programming", "bit-manipulation", "number-theory", "math", "patterns", "tries", "segment-tree", "competitive-programming", "aptitude", "reasoning", "sql", "web-development", "other"]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const asString = (value) => value === null || value === undefined ? null : String(value);
const asId = (value) => /^\d+$/.test(String(value ?? "")) ? String(value) : null;

function parseArgs(argv) {
  const args = { limit: null, contests: null, force: false };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--limit") args.limit = Number.parseInt(argv[++index], 10);
    if (argv[index] === "--contest") args.contests = (argv[++index] ?? "").split(",").map(asId).filter(Boolean);
    if (argv[index] === "--force") args.force = true;
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

function cleanGeneratedText(value) {
  if (typeof value !== "string") return "";
  let text = value.replace(/\r\n?/g, " ").replace(/[ \t]+/g, " ").trim();
  text = text.replace(/([,;:])(?=[A-Za-z])/g, "$1 ");
  text = text.replace(/(\d)([A-Z])/g, "$1 $2");
  text = text.replace(/([a-z])([A-Z])/g, "$1 $2");

  // Split only exact concatenations of known vocabulary terms. This catches
  // cases such as "basicpatterns" and "anddynamic" without guessing at
  // arbitrary word boundaries.
  const knownWords = ["basic", "patterns", "and", "dynamic", "programming", "covering", "using", ...TOPICS].map((word) => word.replace("-", ""));
  text = text.replace(/\b[A-Za-z]{7,}\b/g, (word) => {
    const lower = word.toLowerCase();
    for (const left of knownWords) {
      for (const right of knownWords) {
        if (left.length > 2 && right.length > 2 && left + right === lower) return `${word.slice(0, left.length)} ${word.slice(left.length)}`;
      }
    }
    return word;
  });
  return text;
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
        contestId: { type: "STRING" }, description: { type: "STRING" }, kind: { type: "STRING", enum: KINDS }, domain: { type: "STRING", enum: DOMAINS }, topics: { type: "ARRAY", items: { type: "STRING" } }, primaryTopics: { type: "ARRAY", items: { type: "STRING" } }, course: { type: "STRING", nullable: true }, batch: { type: "STRING", nullable: true }, location: { type: "STRING", nullable: true }, instructor: { type: "STRING", nullable: true }, institution: { type: "STRING", nullable: true }, difficultyProfile: { type: "STRING", enum: DIFFICULTIES }, tags: { type: "ARRAY", items: { type: "STRING" } }, confidence: { type: "NUMBER" },
      },
      required: ["contestId", "description", "kind", "domain", "topics", "primaryTopics", "course", "batch", "location", "instructor", "institution", "difficultyProfile", "tags", "confidence"],
    },
  };
}

function promptFor(batch) {
  return `You are enriching HackerBlocks contest metadata. Return ONLY a JSON array with exactly one object for every supplied contest, using the supplied contestId. Ground every field only in the provided metadata and question titles/difficulties. Kind and domain are different concepts; infer them independently. Do not assume assignment means DSA. For HackerBlocks contents that are programming problems, use domain dsa for algorithms, data structures, algorithmic mathematics, probability implemented through code, expected value, combinatorics, number theory, and mathematical problem solving in code. Use competitive-programming when the set is primarily broad contest-style algorithmic programming rather than a focused educational DSA assignment. Use aptitude ONLY for genuinely non-programming quantitative aptitude or numerical reasoning material. Do not classify programming problems as aptitude or reasoning merely because they involve probability, expectation, arithmetic, math, or logic; question type matters. Never infer an instructor, institution, course, batch, or location without evidence in the supplied contest name or description; use null. A place name may be a center/location identifier rather than a batch. Do not describe a contest as interview preparation, placement-oriented, workshop material, college competition, monthly, or any other audience/purpose unless that purpose is explicitly supported by the supplied metadata. Descriptions must state observable subject matter only, be useful and short (1-2 sentences), and use normal grammatical spacing around punctuation and between every word. Do not merely repeat the contest name. Return exhaustive normalized topics from the preferred vocabulary, then choose at most 4 genuinely dominant primaryTopics; do not take the first four arbitrarily. confidence must be meaningful and reflect certainty of kind, domain, topics, and named metadata fields; question availability alone does not justify 0.95.\n\nAllowed kinds: ${KINDS.join(", ")}\nAllowed domains: ${DOMAINS.join(", ")}\nAllowed difficulty profiles: ${DIFFICULTIES.join(", ")}\nPreferred topics: ${[...TOPICS].join(", ")}\n\nInput contests:\n${JSON.stringify(batch)}`;
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

function sourceText(compact) {
  return `${compact.name} ${compact.originalDescription}`.toLowerCase();
}

function hasSourceEvidence(value, compact) {
  return typeof value === "string" && value.trim() && sourceText(compact).includes(value.trim().toLowerCase());
}

function conservativeMetadataValue(value, compact) {
  if (!hasSourceEvidence(value, compact)) return null;
  return cleanGeneratedText(value.trim()) || null;
}

function conservativeBatch(value, compact) {
  const candidate = conservativeMetadataValue(value, compact);
  if (!candidate) return null;
  const lower = candidate.toLowerCase();
  const locationTerms = ["pitampura", "dwarka", "greater noida", "gurgaon", "gurugram", "noida", "ghaziabad"];
  const hasLocationTerm = locationTerms.some((term) => lower.includes(term));
  const onlyLocation = /^(pitampura|dwarka|greater noida|gurgaon|gurugram|noida|ghaziabad)(?:\s+(?:batch|centre|center))?$/i.test(candidate);
  if (onlyLocation || (hasLocationTerm && !/\b(batch|cohort|section|group)\b/i.test(candidate))) return null;
  return candidate;
}

function primaryTopicsOf(rawTopics, rawPrimaryTopics, questions) {
  const topics = normalizeList(rawTopics, TOPICS);
  const requested = normalizeList(rawPrimaryTopics, TOPICS).filter((topic) => topics.includes(topic));
  if (requested.length > 0) return requested.slice(0, 4);

  // Fallback ranking is based on topic signals in question names, with the
  // model's exhaustive topic list only breaking ties—not array order alone.
  const searchable = questions.map((question) => question.name.toLowerCase().replace(/-/g, " ")).join(" ");
  return topics.map((topic) => {
    const words = topic.replace(/-/g, " ");
    const matches = searchable.match(new RegExp(`\\b${words.replace(/ /g, "\\s+")}\\b`, "g")) ?? [];
    return { topic, score: matches.length };
  }).sort((a, b) => b.score - a.score || a.topic.localeCompare(b.topic)).slice(0, 4).map(({ topic }) => topic);
}

function calibratedConfidence(raw, compact, fields) {
  const modelValue = Number(raw.confidence);
  const modelConfidence = Number.isFinite(modelValue) ? Math.max(0, Math.min(1, modelValue)) : 0.55;
  const evidenceCount = [fields.kind !== "unknown", fields.domain !== "unknown", fields.topics.length > 0, fields.primaryTopics.length > 0].filter(Boolean).length;
  const sourceCap = compact.questions.some((question) => [1, 2, 3].includes(question.difficulty)) ? 0.9 : 0.75;
  const evidenceCap = 0.62 + evidenceCount * 0.07;
  const namedFields = [fields.course, fields.batch, fields.location, fields.instructor, fields.institution];
  const namedFieldPenalty = namedFields.filter(Boolean).length > 0 && namedFields.some((value) => value === null) ? 0.98 : 1;
  return Number(Math.min(modelConfidence, sourceCap, evidenceCap * namedFieldPenalty).toFixed(2));
}

function deterministicYear(compact) {
  const year = compact.startTime ? new Date(compact.startTime).getUTCFullYear() : NaN;
  return Number.isInteger(year) && year >= 1970 && year <= 2200 ? year : null;
}

function normalizeResult(raw, compact, model) {
  if (!raw || !asId(raw.contestId) || asId(raw.contestId) !== String(compact.id)) throw new Error(`Response contained an invalid contestId for ${compact.id}`);
  const topics = normalizeList(raw.topics, TOPICS);
  const primaryTopics = primaryTopicsOf(topics, raw.primaryTopics, compact.questions);
  const kind = KINDS.includes(raw.kind) ? raw.kind : "unknown";
  const domain = DOMAINS.includes(raw.domain) ? raw.domain : "unknown";
  // Difficulty is derived from the source question values, never from Gemini.
  // This remains unknown when the contest has no usable 1/2/3 values.
  const normalizedDifficulty = difficultyProfile(compact.questions);
  const languages = compact.languages;
  const tags = normalizeList([...(Array.isArray(raw.tags) ? raw.tags : []), ...topics, kind, ...languages]);
  const fields = {
    kind,
    domain,
    topics,
    primaryTopics,
    course: conservativeMetadataValue(raw.course, compact),
    batch: conservativeBatch(raw.batch, compact),
    location: conservativeMetadataValue(raw.location, compact),
    instructor: conservativeMetadataValue(raw.instructor, compact),
    institution: conservativeMetadataValue(raw.institution, compact),
  };
  const result = {
    contestId: String(compact.id),
    description: cleanGeneratedText(raw.description).slice(0, 600),
    kind,
    domain,
    topics,
    primaryTopics,
    course: fields.course,
    batch: fields.batch,
    location: fields.location,
    instructor: fields.instructor,
    institution: fields.institution,
    year: deterministicYear(compact),
    difficultyProfile: normalizedDifficulty,
    languages,
    tags,
    confidence: calibratedConfidence(raw, compact, fields),
    sourceQuality: compact.questions.length > 0 ? "metadata+questions" : "metadata-only",
    model,
    generatedAt: new Date().toISOString(),
  };
  return result;
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
      error.status = response.status;
      const retryAfter = Number.parseFloat(response.headers.get("retry-after") ?? "");
      error.retryAfterMs = Number.isFinite(retryAfter) ? Math.min(120000, Math.max(1000, retryAfter * 1000)) : null;
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
  let pending = args.force ? contests : contests.filter((contest) => !completedIds.has(contestIdOf(contest)));
  if (args.contests) pending = pending.filter((contest) => args.contests.includes(contestIdOf(contest)));
  pending = [...new Map(pending.map((contest) => [contestIdOf(contest), contest])).values()];
  if (args.limit !== null) pending = pending.slice(0, args.limit);

  await fs.mkdir("data", { recursive: true });
  const concurrencySetting = Number.parseInt(process.env.GEMINI_CONCURRENCY ?? String(keys.length), 10) || keys.length;
  const workerCount = Math.min(keys.length, 8, Math.max(1, concurrencySetting));
  const batches = [];
  for (let index = 0; index < pending.length; index += batchSize) batches.push(pending.slice(index, index + batchSize));
  let completed = 0; let requests = 0; let retries = 0; let failedBatches = 0; let nextBatch = 0; let inFlight = 0; let maxInFlight = 0;
  let writeTail = Promise.resolve();
  const appendRecords = (records) => {
    const write = writeTail.then(() => fs.appendFile(OUTPUT_FILE, records.map((record) => `${JSON.stringify(record)}\n`).join(""), "utf8"));
    writeTail = write.catch(() => {});
    return write;
  };
  console.log(`${workerCount} worker(s), batch size ${batchSize}, up to ${workerCount * batchSize} contests in flight`);

  async function requestWithWorker(batch, worker) {
    const compact = batch.map((contest) => compactContest(contest, contentsByContest));
    const orderedModelIndexes = [...models.keys()].map((offset) => (worker.preferredModelIndex + offset) % models.length);
    let lastError = null;
    let sawQuotaError = false;
    let sawKeyError = false;
    for (const modelIndex of orderedModelIndexes) {
      const model = models[modelIndex];
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        // A 429 puts this worker into cooldown, but it may still try the
        // remaining models once with the normal per-worker request spacing.
        if (worker.cooldownUntil > Date.now()) await sleep(Math.min(worker.cooldownUntil - Date.now(), delayMs));
        const elapsed = Date.now() - worker.lastRequestAt;
        if (elapsed < delayMs) await sleep(delayMs - elapsed);
        worker.lastRequestAt = Date.now();
        console.log(`[${worker.id}] batch start model=${model}`);
        requests++;
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        try {
          const rawResults = await requestBatch(compact, keys[worker.keyIndex], model, timeoutMs);
          if (rawResults.length !== batch.length) throw new Error(`Expected ${batch.length} results but received ${rawResults.length}`);
          const byId = new Map(rawResults.map((result) => [asId(result?.contestId), result]));
          if (byId.size !== batch.length || compact.some((item) => !byId.has(String(item.id)))) throw new Error("Gemini response did not contain exactly the requested contest IDs");
          const normalized = compact.map((item) => normalizeResult(byId.get(String(item.id)), item, model));
          await appendRecords(normalized);
          worker.preferredModelIndex = modelIndex;
          worker.cooldownUntil = 0;
          return { normalized, model };
        } catch (error) {
          lastError = error;
          if (error?.status === 401 || error?.status === 403) {
            sawKeyError = true;
            break;
          }
          if (error?.status === 429) {
            sawQuotaError = true;
            worker.cooldownUntil = Date.now() + (error.retryAfterMs ?? Math.min(60000, 30000 * 2 ** attempt));
            console.log(`[${worker.id}] key cooling down ${Math.ceil((worker.cooldownUntil - Date.now()) / 1000)}s`);
            break;
          }
          const transient = error?.transient || error?.name === "AbortError" || /JSON|response|network|fetch/i.test(error?.message ?? "");
          if (!transient || attempt >= maxRetries - 1) break;
          retries++;
          const waitMs = Math.min(60000, 2000 * 2 ** attempt);
          if (debug) console.log(`[${worker.id}] retrying after ${waitMs}ms`);
          await sleep(waitMs);
        } finally {
          inFlight--;
        }
      }
    }
    if (sawQuotaError || sawKeyError) {
      worker.cooldownUntil = Math.max(worker.cooldownUntil, Date.now() + (sawKeyError ? 300000 : 30000));
      lastError.workerCooldown = true;
      lastError.cooldownMs = worker.cooldownUntil - Date.now();
    }
    throw lastError ?? new Error("All configured Gemini models failed");
  }

  async function processBatch(batch, worker) {
    try {
      const result = await requestWithWorker(batch, worker);
      completed += result.normalized.length;
      console.log(`[${worker.id}] ${result.normalized.length} contests completed model=${result.model} [${completed}/${pending.length}]`);
    } catch (error) {
      if (error?.workerCooldown) {
        // Nothing was persisted. Return the batch to the shared queue so a
        // healthy key can own it; isolate this quota-exhausted worker for the
        // remainder of this run instead of letting it block the queue.
        batches.push(batch);
        worker.unavailable = true;
        console.log(`[${worker.id}] key cooling down ${Math.ceil(error.cooldownMs / 1000)}s; batch requeued for another worker`);
        return;
      }
      if (batch.length > 1) {
        const midpoint = Math.ceil(batch.length / 2);
        await processBatch(batch.slice(0, midpoint), worker);
        await processBatch(batch.slice(midpoint), worker);
        return;
      }
      failedBatches++;
      await fs.appendFile(FAILURES_FILE, `${JSON.stringify({ contestId: contestIdOf(batch[0]), error: error?.message ?? "unknown error", failedAt: new Date().toISOString() })}\n`, "utf8");
      console.error(`[${worker.id}] failed contest ${contestIdOf(batch[0])}; it remains pending for a later run.`);
    }
  }

  async function workerLoop(worker) {
    while (true) {
      if (worker.unavailable) return;
      const batchIndex = nextBatch++;
      if (batchIndex >= batches.length) return;
      await processBatch(batches[batchIndex], worker);
    }
  }

  const workers = Array.from({ length: workerCount }, (_, index) => ({ id: `w${index + 1}`, keyIndex: index, preferredModelIndex: index % models.length, lastRequestAt: 0, cooldownUntil: 0, unavailable: false }));
  await Promise.all(workers.map(workerLoop));
  console.log(`Done: completed=${completed} remaining=${pending.length - completed} requests=${requests} retries=${retries} failed batches=${failedBatches} max in flight=${maxInFlight}`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
