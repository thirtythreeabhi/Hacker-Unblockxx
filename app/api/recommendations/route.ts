import fs from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { buildRecommendations, parseEmbedding, type NearDuplicatePair, type RecommendationMode, type RecommendationProblem, type RecommendationProgress } from "../../../lib/recommendations";
import { createClient } from "../../../lib/supabase/server";

export const runtime = "nodejs";

const MODES = new Set<RecommendationMode>(["continue", "harder", "bookmarked", "random", "weak"]);
const NEAR_DUPLICATES_FILE = "data/problem-near-duplicates.json";

type Input = { mode: RecommendationMode; currentProblemId: string | null; topic: string | null; limit: number; excludeProblemIds: string[] };
type DatabaseProblem = { problem_id: string; content_id: string | null; contest_id: string | null; name: string; difficulty: number | null; topics: unknown; primary_topics: unknown; domain: string | null; embedding?: unknown };

function inputFrom(value: Record<string, unknown>): Input {
  const rawMode = typeof value.mode === "string" ? value.mode.toLowerCase() as RecommendationMode : "random";
  const rawLimit = Number.parseInt(String(value.limit ?? "5"), 10);
  return {
    mode: MODES.has(rawMode) ? rawMode : "random",
    currentProblemId: /^\d+$/.test(String(value.currentProblemId ?? "")) ? String(value.currentProblemId) : null,
    topic: typeof value.topic === "string" && value.topic.trim() ? value.topic.trim().toLowerCase() : null,
    limit: Number.isInteger(rawLimit) ? Math.min(10, Math.max(1, rawLimit)) : 5,
    excludeProblemIds: typeof value.exclude === "string" ? value.exclude.split(",").filter((id) => /^\d+$/.test(id)).slice(0, 100) : [],
  };
}

async function readInput(request: NextRequest) {
  if (request.method === "GET") return inputFrom(Object.fromEntries(request.nextUrl.searchParams.entries()));
  const body = await request.json().catch(() => ({}));
  return inputFrom(body && typeof body === "object" ? body : {});
}

async function readNearDuplicates() {
  try {
    const text = await fs.readFile(NEAR_DUPLICATES_FILE, "utf8");
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.filter((pair): pair is NearDuplicatePair => /^\d+$/.test(String(pair?.problemIdA)) && /^\d+$/.test(String(pair?.problemIdB))) : [];
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as Error & { code?: string }).code === "ENOENT") return [];
    return [];
  }
}

async function readProblems(supabase: Awaited<ReturnType<typeof createClient>>, includeEmbeddings: boolean) {
  const columns = includeEmbeddings ? "problem_id,content_id,contest_id,name,difficulty,topics,primary_topics,domain,embedding" : "problem_id,content_id,contest_id,name,difficulty,topics,primary_topics,domain";
  const problems: DatabaseProblem[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from("problem_search").select(columns).range(offset, offset + 999);
    if (error) throw new Error(`Recommendation corpus is unavailable: ${error.message}`);
    problems.push(...((data ?? []) as unknown as DatabaseProblem[]));
    if (!data || data.length < 1000) break;
  }
  return problems;
}

function normalizeProblem(row: DatabaseProblem, includeEmbeddings: boolean): RecommendationProblem {
  const difficulty = typeof row.difficulty === "number" && [1, 2, 3].includes(row.difficulty) ? row.difficulty as 1 | 2 | 3 : null;
  return {
    problemId: String(row.problem_id), contentId: row.content_id ? String(row.content_id) : null, contestId: row.contest_id ? String(row.contest_id) : null,
    name: String(row.name ?? "Untitled problem"), difficulty,
    topics: Array.isArray(row.topics) ? row.topics.map(String) : [], primaryTopics: Array.isArray(row.primary_topics) ? row.primary_topics.map(String).slice(0, 4) : [], domain: row.domain ?? null,
    embedding: includeEmbeddings ? parseEmbedding(row.embedding) : null,
  };
}

export async function GET(request: NextRequest) { return handle(request); }
export async function POST(request: NextRequest) { return handle(request); }

async function handle(request: NextRequest) {
  const input = await readInput(request);
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try { supabase = await createClient(); } catch { return NextResponse.json({ available: false, results: [], error: "Recommendations are not configured." }, { status: 503 }); }
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return NextResponse.json({ available: false, results: [], error: "Log in to get personalized recommendations." }, { status: 401 });

  try {
    const includeEmbeddings = input.mode === "continue" || input.mode === "harder";
    const [databaseProblems, progressResponse, nearDuplicates] = await Promise.all([
      readProblems(supabase, includeEmbeddings),
      supabase.from("problem_progress").select("problem_id, bookmarked, completed, completed_at, updated_at").eq("user_id", userData.user.id),
      readNearDuplicates(),
    ]);
    if (progressResponse.error) throw new Error(`Your progress is unavailable: ${progressResponse.error.message}`);
    const progress = ((progressResponse.data ?? []) as Array<{ problem_id: string; bookmarked: boolean; completed: boolean; completed_at: string | null; updated_at: string | null }>).map((row): RecommendationProgress => ({ problemId: String(row.problem_id), bookmarked: row.bookmarked === true, completed: row.completed === true, completedAt: row.completed_at, updatedAt: row.updated_at }));
    const problems = databaseProblems.map((row) => normalizeProblem(row, includeEmbeddings));
    const results = buildRecommendations({ problems, progress, mode: input.mode, currentProblemId: input.currentProblemId, topic: input.topic, limit: input.limit, nearDuplicates, excludeProblemIds: input.excludeProblemIds, seed: `${userData.user.id}:${new Date().toISOString().slice(0, 10)}` });
    return NextResponse.json({ available: true, mode: input.mode, results });
  } catch (error) {
    return NextResponse.json({ available: false, results: [], error: error instanceof Error ? error.message : "Recommendations are temporarily unavailable." }, { status: 503 });
  }
}
