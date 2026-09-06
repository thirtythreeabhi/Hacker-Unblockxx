import fs from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { GeminiEmbeddingClient, embeddingConfig } from "./gemini-embedding.mjs";

const CORPUS_FILE = "data/problem-corpus.jsonl";
const ENRICHMENT_FILE = "data/contest-enrichment.jsonl";

function parseArgs(argv) {
  const args = { limit: null, problems: null, force: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--limit") args.limit = Number.parseInt(argv[++index], 10);
    else if (argv[index] === "--problem") args.problems = (argv[++index] ?? "").split(",").map((value) => /^\d+$/.test(value) ? value : null).filter(Boolean);
    else if (argv[index] === "--force") args.force = true;
    else throw new Error(`Unknown option: ${argv[index]}`);
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

function asId(value) { return /^\d+$/.test(String(value ?? "")) ? String(value) : null; }
function asText(value) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function uniqueStrings(value) { return Array.isArray(value) ? [...new Set(value.map((item) => String(item).trim()).filter(Boolean))] : []; }

function validCorpusRecord(record) {
  return Boolean(asId(record?.problemId) && asId(record?.contentId) && asId(record?.contestId) && asText(record?.name) && /^[a-f0-9]{64}$/i.test(record?.sourceHash));
}

function enrichmentMap(records) {
  return new Map(records.map((record) => [asId(record?.contestId), record]).filter(([id]) => id));
}

function embeddingText(record, enrichment) {
  const sections = [
    `Problem: ${record.name}`,
    record.difficulty ? `Difficulty: ${record.difficulty}` : null,
    record.problemType ? `Problem type: ${record.problemType}` : null,
    enrichment?.domain ? `Domain: ${enrichment.domain}` : null,
    uniqueStrings(enrichment?.primaryTopics).length ? `Primary topics: ${uniqueStrings(enrichment.primaryTopics).join(", ")}` : null,
    uniqueStrings(enrichment?.topics).length ? `Topics: ${uniqueStrings(enrichment.topics).join(", ")}` : null,
    record.description ? `Description:\n${record.description}` : null,
    record.constraints ? `Constraints:\n${record.constraints}` : null,
    record.inputFormat ? `Input format:\n${record.inputFormat}` : null,
    record.outputFormat ? `Output format:\n${record.outputFormat}` : null,
    record.sampleInput ? `Sample input:\n${record.sampleInput}` : null,
    record.sampleOutput ? `Sample output:\n${record.sampleOutput}` : null,
  ];
  return sections.filter(Boolean).join("\n\n").slice(0, 30000);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!supabaseUrl) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL before embedding problems.");
  if (!serviceRoleKey) throw new Error("Embedding writes require SUPABASE_SERVICE_ROLE_KEY (server-only); no database write was attempted.");
  const config = embeddingConfig();
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const corpus = (await readJsonl(CORPUS_FILE)).filter(validCorpusRecord);
  if (!corpus.length) throw new Error(`No valid records found in ${CORPUS_FILE}. Run build-problem-corpus.mjs first.`);
  const records = [...new Map(corpus.map((record) => [record.problemId, record])).values()];
  let selected = args.problems ? records.filter((record) => args.problems.includes(record.problemId)) : records;
  if (args.problems) {
    const found = new Set(selected.map((record) => record.problemId));
    const missing = args.problems.filter((problemId) => !found.has(problemId));
    if (missing.length) throw new Error(`Problem ID(s) not found in ${CORPUS_FILE}: ${missing.join(", ")}`);
  }
  if (args.limit !== null) selected = selected.slice(0, args.limit);
  const enrichment = enrichmentMap(await readJsonl(ENRICHMENT_FILE));
  const existingById = new Map();
  for (let offset = 0; offset < selected.length; offset += 100) {
    const ids = selected.slice(offset, offset + 100).map((record) => record.problemId);
    const { data, error } = await supabase.from("problem_search").select("problem_id, source_hash, embedding_model").in("problem_id", ids);
    if (error) throw new Error(`Could not read problem_search; run the migration first (${error.message}).`);
    for (const row of data ?? []) existingById.set(String(row.problem_id), row);
  }
  const pending = args.force ? selected : selected.filter((record) => {
    const existing = existingById.get(record.problemId);
    return !existing || existing.source_hash !== record.sourceHash || existing.embedding_model !== config.model;
  });
  console.log(`Embedding candidates=${selected.length} pending=${pending.length} model=${config.model} dimensions=${config.dimensions} force=${args.force}`);
  if (!pending.length) return;

  const client = new GeminiEmbeddingClient(config);
  const concurrency = Math.min(8, Math.max(1, Number.parseInt(process.env.EMBEDDING_CONCURRENCY ?? String(config.keys.length), 10) || config.keys.length));
  let next = 0; let completed = 0; let failed = 0;
  async function worker(workerId) {
    while (true) {
      const index = next++;
      if (index >= pending.length) return;
      const record = pending[index];
      try {
        const values = await client.embed(embeddingText(record, enrichment.get(record.contestId)));
        const row = {
          problem_id: record.problemId,
          content_id: record.contentId,
          contest_id: record.contestId,
          name: record.name,
          difficulty: record.difficulty,
          description: record.description,
          constraints: record.constraints,
          input_format: record.inputFormat,
          output_format: record.outputFormat,
          topics: uniqueStrings(enrichment.get(record.contestId)?.topics),
          primary_topics: uniqueStrings(enrichment.get(record.contestId)?.primaryTopics).slice(0, 4),
          domain: asText(enrichment.get(record.contestId)?.domain),
          source_hash: record.sourceHash,
          embedding: `[${values.join(",")}]`,
          embedding_model: config.model,
          embedded_at: new Date().toISOString(),
        };
        const { error } = await supabase.from("problem_search").upsert(row, { onConflict: "problem_id" });
        if (error) throw new Error(`Supabase upsert failed: ${error.message}`);
        completed += 1;
        console.log(`[w${workerId}] ${record.problemId} embedded [${completed}/${pending.length}]`);
      } catch (error) {
        failed += 1;
        console.error(`[w${workerId}] failed problem ${record.problemId}: ${error.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, (_, index) => worker(index + 1)));
  console.log(`Done: completed=${completed} failed=${failed}`);
  if (failed) process.exitCode = 2;
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
