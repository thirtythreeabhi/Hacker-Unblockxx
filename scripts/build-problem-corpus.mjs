import crypto from "node:crypto";
import fs from "node:fs/promises";

const CONTENTS_FILE = "data/contest-contents.jsonl";
const OUTPUT_FILE = "data/problem-corpus.jsonl";
const FAILURES_FILE = "data/problem-corpus-failures.jsonl";
const API_ROOT = "https://hack-api.codingblocks.com/api/v2";
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const asId = (value) => /^\d+$/.test(String(value ?? "")) ? String(value) : null;
const asText = (value) => typeof value === "string" && value.trim() ? value.trim() : null;

function parseArgs(argv) {
  const args = { limit: null, problems: null, force: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--limit") args.limit = Number.parseInt(argv[++index], 10);
    else if (argv[index] === "--problem") args.problems = (argv[++index] ?? "").split(",").map(asId).filter(Boolean);
    else if (argv[index] === "--force") args.force = true;
    else throw new Error(`Unknown option: ${argv[index]}`);
  }
  if (args.limit !== null && (!Number.isInteger(args.limit) || args.limit < 1)) throw new Error("--limit must be a positive integer");
  if (args.problems && args.problems.length === 0) throw new Error("--problem must contain one or more numeric IDs");
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

const HTML_ENTITIES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };

function htmlishToText(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  let text = value.replace(/\r\n?/g, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/?(?:p|div|h[1-6])\b[^>]*>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#(?:x[\da-f]+|\d+)|[a-z][a-z\d]+);/gi, (entity, key) => {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey in HTML_ENTITIES) return HTML_ENTITIES[normalizedKey];
      if (normalizedKey.startsWith("#x")) {
        const codePoint = Number.parseInt(normalizedKey.slice(2), 16);
        return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
      }
      if (normalizedKey.startsWith("#")) {
        const codePoint = Number.parseInt(normalizedKey.slice(1), 10);
        return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
      }
      return entity;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n")
    .trim();
  return text || null;
}

// This is the Node-side equivalent of lib/question.ts. It deliberately keeps
// only trusted problem fields and excludes explanations and solution stubs.
function normalizeQuestion(payload, fallbackContentId) {
  const content = payload?.data ?? {};
  const contentAttributes = content?.attributes ?? {};
  const problem = Array.isArray(payload?.included)
    ? payload.included.find((resource) => resource?.type === "problems")
    : null;
  const problemAttributes = problem?.attributes ?? {};
  const details = problemAttributes.details ?? {};
  return {
    contentId: String(content?.id ?? fallbackContentId),
    problemId: asId(problem?.id ?? content?.relationships?.problem?.data?.id),
    name: String(contentAttributes.name ?? problemAttributes.name ?? "Untitled question").trim(),
    difficulty: [1, 2, 3].includes(problemAttributes.difficulty)
      ? problemAttributes.difficulty
      : [1, 2, 3].includes(contentAttributes.difficulty) ? contentAttributes.difficulty : null,
    description: htmlishToText(details.description),
    constraints: htmlishToText(details.constraints),
    inputFormat: htmlishToText(details.input_format),
    outputFormat: htmlishToText(details.output_format),
    sampleInput: asText(details.sample_input),
    sampleOutput: asText(details.sample_output),
    problemType: asText(problemAttributes["problem-type"]),
  };
}

function sourceHash(question, source) {
  const canonical = JSON.stringify({
    problemId: question.problemId,
    contentId: question.contentId,
    contestId: source.contestId,
    name: question.name,
    difficulty: question.difficulty,
    description: question.description,
    constraints: question.constraints,
    inputFormat: question.inputFormat,
    outputFormat: question.outputFormat,
    sampleInput: question.sampleInput,
    sampleOutput: question.sampleOutput,
    problemType: question.problemType,
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

function validRecord(record) {
  return Boolean(asId(record?.problemId) && asId(record?.contentId) && asId(record?.contestId)
    && asText(record?.name) && /^[a-f0-9]{64}$/i.test(record?.sourceHash)
    && !Object.hasOwn(record, "explanation") && !Object.hasOwn(record, "solutionStubs"));
}

function candidatesFromRecord(record, candidates) {
  if (record?.status !== 200 || !Array.isArray(record.data)) return;
  const contestId = asId(record.contest_id);
  if (!contestId) return;
  for (const item of record.data) {
    const contentId = asId(item?.id);
    const problemId = asId(item?.relationships?.problem?.data?.id);
    if (!contentId || !problemId) continue;
    const candidate = { problemId, contentId, contestId, name: String(item?.attributes?.name ?? "Untitled question").trim(), difficulty: item?.attributes?.difficulty ?? null };
    if (!candidates.has(problemId)) candidates.set(problemId, []);
    candidates.get(problemId).push(candidate);
  }
}

async function fetchCandidate(candidate, timeoutMs, maxRetries) {
  const url = `${API_ROOT}/contents/${encodeURIComponent(candidate.contentId)}?contest_id=${encodeURIComponent(candidate.contestId)}&include=problem,quiz,project,web-challenge`;
  let lastError = null;
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/vnd.api+json, application/json" } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(`HackerBlocks source returned HTTP ${response.status}`);
        error.status = response.status;
        error.transient = TRANSIENT_STATUS.has(response.status);
        error.retryAfterMs = Number.parseFloat(response.headers.get("retry-after") ?? "") * 1000;
        throw error;
      }
      const question = normalizeQuestion(payload, candidate.contentId);
      if (question.problemId !== candidate.problemId) throw new Error(`Source problem ID mismatch for ${candidate.problemId}`);
      return question;
    } catch (error) {
      lastError = error;
      const transient = error?.transient || error?.name === "AbortError" || /fetch|network|mismatch/i.test(error?.message ?? "");
      if (!transient || attempt >= maxRetries - 1) break;
      const retryAfter = Number.isFinite(error?.retryAfterMs) && error.retryAfterMs > 0 ? Math.min(120000, error.retryAfterMs) : 1000 * 2 ** attempt;
      await sleep(Math.min(120000, retryAfter));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError ?? new Error("Source request failed");
}

function corpusRecord(question, source) {
  return {
    problemId: question.problemId,
    contentId: question.contentId,
    contestId: source.contestId,
    name: question.name,
    difficulty: question.difficulty,
    description: question.description,
    constraints: question.constraints,
    inputFormat: question.inputFormat,
    outputFormat: question.outputFormat,
    sampleInput: question.sampleInput,
    sampleOutput: question.sampleOutput,
    problemType: question.problemType,
    sourceHash: sourceHash(question, source),
    fetchedAt: new Date().toISOString(),
  };
}

async function writeJsonl(file, records) {
  const temporary = `${file}.tmp-${process.pid}`;
  await fs.writeFile(temporary, records.map((record) => `${JSON.stringify(record)}\n`).join(""), "utf8");
  await fs.rm(file, { force: true });
  await fs.rename(temporary, file);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const timeoutMs = Math.max(5000, Number.parseInt(process.env.CORPUS_REQUEST_TIMEOUT_MS ?? "30000", 10) || 30000);
  const maxRetries = Math.max(1, Number.parseInt(process.env.CORPUS_MAX_RETRIES ?? "4", 10) || 4);
  const delayMs = Math.max(0, Number.parseInt(process.env.CORPUS_REQUEST_DELAY_MS ?? "150", 10) || 0);
  const concurrency = Math.min(16, Math.max(1, Number.parseInt(process.env.CORPUS_CONCURRENCY ?? "4", 10) || 4));
  const contentLines = await fs.readFile(CONTENTS_FILE, "utf8");
  const candidates = new Map();
  for (const line of contentLines.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { candidatesFromRecord(JSON.parse(line), candidates); } catch { /* tolerate a truncated final JSONL line */ }
  }
  const existing = (await readJsonl(OUTPUT_FILE)).filter(validRecord);
  const recordsByProblem = new Map(existing.map((record) => [record.problemId, record]));
  const availableIds = [...candidates.keys()];
  let ids = args.problems ?? availableIds;
  ids = [...new Set(ids)].filter((problemId) => candidates.has(problemId));
  if (args.problems) {
    const missing = args.problems.filter((problemId) => !candidates.has(problemId));
    if (missing.length) throw new Error(`No known contest/content candidate for problem ID(s): ${missing.join(", ")}`);
  }
  if (!args.problems && args.limit !== null) ids = ids.slice(0, args.limit);
  if (args.problems && args.limit !== null) ids = ids.slice(0, args.limit);
  const pending = args.force ? ids : ids.filter((problemId) => !recordsByProblem.has(problemId));
  await fs.mkdir("data", { recursive: true });
  console.log(`Corpus candidates=${ids.length} pending=${pending.length} concurrency=${concurrency} force=${args.force}`);
  if (pending.length === 0) { console.log("Nothing to fetch."); return; }

  let next = 0; let completed = 0; let failed = 0;
  let writeTail = Promise.resolve();
  const persist = () => {
    writeTail = writeTail.then(() => writeJsonl(OUTPUT_FILE, [...recordsByProblem.values()])).catch(() => {});
    return writeTail;
  };
  const appendFailure = async (failure) => fs.appendFile(FAILURES_FILE, `${JSON.stringify(failure)}\n`, "utf8");
  async function worker(workerId) {
    while (true) {
      const index = next++;
      if (index >= pending.length) return;
      const problemId = pending[index];
      const orderedCandidates = [...candidates.get(problemId)].sort((left, right) => {
        if (problemId === "209") return Number(right.contestId === "10235") - Number(left.contestId === "10235");
        return 0;
      });
      let question = null; let source = null; let lastError = null;
      for (const candidate of orderedCandidates) {
        try {
          if (delayMs) await sleep(delayMs);
          question = await fetchCandidate(candidate, timeoutMs, maxRetries);
          source = candidate;
          break;
        } catch (error) { lastError = error; }
      }
      if (!question || !source) {
        failed += 1;
        await appendFailure({ problemId, error: lastError?.message ?? "No candidate could be fetched", failedAt: new Date().toISOString() });
        console.error(`[w${workerId}] failed problem ${problemId}: ${lastError?.message ?? "unknown error"}`);
        continue;
      }
      recordsByProblem.set(problemId, corpusRecord(question, source));
      await persist();
      completed += 1;
      console.log(`[w${workerId}] ${problemId} fetched [${completed}/${pending.length}]`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, (_, index) => worker(index + 1)));
  await writeTail;
  console.log(`Done: completed=${completed} failed=${failed} total=${recordsByProblem.size}`);
  if (failed > 0) process.exitCode = 2;
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
