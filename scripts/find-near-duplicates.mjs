import fs from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const OUTPUT_FILE = "data/problem-near-duplicates.json";

function parseArgs(argv) {
  const args = { threshold: Number.parseFloat(process.env.NEAR_DUPLICATE_THRESHOLD ?? "0.94"), limit: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--threshold") args.threshold = Number.parseFloat(argv[++index]);
    else if (argv[index] === "--limit") args.limit = Number.parseInt(argv[++index], 10);
    else throw new Error(`Unknown option: ${argv[index]}`);
  }
  if (!Number.isFinite(args.threshold) || args.threshold < 0.8 || args.threshold > 1) throw new Error("--threshold must be between 0.8 and 1.");
  if (args.limit !== null && (!Number.isInteger(args.limit) || args.limit < 2)) throw new Error("--limit must be at least 2.");
  return args;
}

function parseVector(value) {
  if (Array.isArray(value)) return value.every((item) => typeof item === "number" && Number.isFinite(item)) ? value : null;
  if (typeof value !== "string" || !/^\[[\d.eE+\-, ]+\]$/.test(value)) return null;
  const values = value.slice(1, -1).split(",").map(Number);
  return values.length && values.every(Number.isFinite) ? values : null;
}

function cosine(left, right) {
  let dot = 0; let leftNorm = 0; let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

// High-similarity vectors almost always share signs across these deterministic
// dimension bands. LSH avoids an expensive all-pairs 768D comparison for the
// full corpus while keeping this detector conservative (false negatives are
// preferable to asserting unrelated problems are duplicates).
function candidatePairs(rows) {
  if (rows.length <= 250) {
    const pairs = [];
    for (let left = 0; left < rows.length; left += 1) for (let right = left + 1; right < rows.length; right += 1) pairs.push([left, right]);
    return pairs;
  }
  const buckets = Array.from({ length: 4 }, () => new Map());
  for (let index = 0; index < rows.length; index += 1) {
    const vector = rows[index].vector;
    for (let band = 0; band < 4; band += 1) {
      let signature = "";
      for (let offset = 0; offset < 16; offset += 1) signature += vector[band * 16 + offset] >= 0 ? "1" : "0";
      const bucket = buckets[band].get(signature) ?? [];
      bucket.push(index);
      buckets[band].set(signature, bucket);
    }
  }
  const pairs = new Set();
  for (const bucketMap of buckets) for (const bucket of bucketMap.values()) {
    for (let left = 0; left < bucket.length; left += 1) for (let right = left + 1; right < bucket.length; right += 1) {
      const a = Math.min(bucket[left], bucket[right]); const b = Math.max(bucket[left], bucket[right]);
      pairs.add(`${a}:${b}`);
    }
  }
  return [...pairs].map((pair) => pair.split(":").map(Number));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to inspect stored embeddings.");
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from("problem_search").select("problem_id,name,embedding").not("embedding", "is", null).range(offset, offset + 499);
    if (error) throw new Error(`Could not read problem_search: ${error.message}`);
    rows.push(...(data ?? []).map((row) => ({ problemId: String(row.problem_id), name: String(row.name ?? "Untitled problem"), vector: parseVector(row.embedding) })).filter((row) => row.vector));
    if (!data || data.length < 500) break;
  }
  const usable = args.limit ? rows.slice(0, args.limit) : rows;
  const dimension = usable[0]?.vector.length ?? 0;
  const comparable = usable.filter((row) => row.vector.length === dimension);
  const pairs = [];
  for (const [leftIndex, rightIndex] of candidatePairs(comparable)) {
    const left = comparable[leftIndex]; const right = comparable[rightIndex];
    const similarity = cosine(left.vector, right.vector);
    if (similarity >= args.threshold) pairs.push({ label: "potential near-duplicates", problemIdA: left.problemId, problemIdB: right.problemId, similarity: Number(similarity.toFixed(6)), nameA: left.name, nameB: right.name });
  }
  pairs.sort((left, right) => right.similarity - left.similarity || left.problemIdA.localeCompare(right.problemIdA));
  await fs.mkdir("data", { recursive: true });
  await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(pairs, null, 2)}\n`, "utf8");
  console.log(`Wrote ${OUTPUT_FILE}: ${pairs.length} potential near-duplicates from ${comparable.length} embeddings at threshold ${args.threshold}`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
