import { NextRequest, NextResponse } from "next/server";
import {
  embedQuery,
  embeddingDimensions,
  embeddingModel,
} from "../../../../lib/gemini/embedding";
import { createClient } from "../../../../lib/supabase/server";

export const runtime = "nodejs";

const DOMAIN_VALUES = new Set([
  "dsa",
  "programming-basics",
  "competitive-programming",
  "web-development",
  "sql",
  "aptitude",
  "reasoning",
  "mixed",
  "other",
  "unknown",
]);
const MODE_VALUES = new Set(["related", "easier", "harder"]);

type SearchOptions = {
  query: string;
  problemId: string | null;
  mode: "related" | "easier" | "harder";
  difficulty: number | null;
  domain: string | null;
  topic: string | null;
  completed: boolean | null;
  bookmarked: boolean | null;
  limit: number;
};

type MatchRow = {
  problem_id: string | number;
  name: string | null;
  difficulty: number | null;
  topics: unknown;
  domain: string | null;
  similarity: number | null;
};

function boolParam(value: unknown) {
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return null;
}

function optionsFrom(input: Record<string, unknown>): SearchOptions {
  const rawDifficulty = Number.parseInt(String(input.difficulty ?? ""), 10);
  const difficulty = [1, 2, 3].includes(rawDifficulty) ? rawDifficulty : null;
  const rawDomain =
    typeof input.domain === "string" ? input.domain.trim().toLowerCase() : "";
  const rawMode =
    typeof input.mode === "string"
      ? input.mode.trim().toLowerCase()
      : "related";
  const rawLimit = Number.parseInt(String(input.limit ?? "8"), 10);
  return {
    query: typeof input.query === "string" ? input.query.trim() : "",
    problemId: /^\d+$/.test(String(input.problemId ?? ""))
      ? String(input.problemId)
      : null,
    mode: MODE_VALUES.has(rawMode)
      ? (rawMode as SearchOptions["mode"])
      : "related",
    difficulty,
    domain: DOMAIN_VALUES.has(rawDomain) ? rawDomain : null,
    topic:
      typeof input.topic === "string" && input.topic.trim()
        ? input.topic.trim().toLowerCase()
        : null,
    completed: boolParam(input.completed),
    bookmarked: boolParam(input.bookmarked),
    limit: Number.isInteger(rawLimit) ? Math.min(20, Math.max(1, rawLimit)) : 8,
  };
}

async function requestInput(request: NextRequest): Promise<SearchOptions> {
  if (request.method === "GET") {
    const params = request.nextUrl.searchParams;
    return optionsFrom(Object.fromEntries(params.entries()));
  }
  const body = await request.json().catch(() => ({}));
  return optionsFrom(body && typeof body === "object" ? body : {});
}

function unavailable(message: string, status = 503) {
  return NextResponse.json(
    { available: false, error: message, results: [] },
    { status },
  );
}

function vectorLiteral(value: unknown) {
  if (Array.isArray(value)) return `[${value.join(",")}]`;
  if (typeof value === "string" && /^\[[\d.eE+\-, ]+\]$/.test(value))
    return value;
  return null;
}

async function applyPersonalFilters<
  T extends { problemId: string; completed: boolean; bookmarked: boolean },
>(
  supabase: Awaited<ReturnType<typeof createClient>>,
  results: T[],
  options: SearchOptions,
): Promise<T[]> {
  if (options.completed === null && options.bookmarked === null) return results;
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user)
    throw new Error("Log in to use completed and bookmarked filters.");
  const { data, error } = await supabase
    .from("problem_progress")
    .select("problem_id, completed, bookmarked")
    .eq("user_id", userData.user.id)
    .in(
      "problem_id",
      results.map((result) => result.problemId),
    );
  if (error)
    throw new Error(`Progress filters are unavailable: ${error.message}`);
  const progress = new Map(
    (data ?? []).map((row) => [
      String(row.problem_id),
      {
        completed: row.completed === true,
        bookmarked: row.bookmarked === true,
      },
    ]),
  );
  return results.filter((result) => {
    const saved = progress.get(result.problemId) ?? {
      completed: false,
      bookmarked: false,
    };
    return (
      (options.completed === null || saved.completed === options.completed) &&
      (options.bookmarked === null || saved.bookmarked === options.bookmarked)
    );
  });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}

async function handle(request: NextRequest) {
  const options = await requestInput(request);
  if (!options.query && !options.problemId)
    return NextResponse.json(
      {
        available: true,
        results: [],
        error: "Provide a search query or problemId.",
      },
      { status: 400 },
    );
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return unavailable("Semantic search is not configured.");
  }

  try {
    let queryEmbedding: number[] | null = null;
    let currentDifficulty: number | null = options.difficulty;
    if (options.problemId) {
      const { data: current, error } = await supabase
        .from("problem_search")
        .select("problem_id, difficulty, embedding")
        .eq("problem_id", options.problemId)
        .maybeSingle();
      if (error)
        return unavailable(
          "Semantic search is not available until the search migration is applied.",
        );
      if (!current)
        return unavailable("This problem does not have an embedding yet.", 200);
      const literal = vectorLiteral(current.embedding);
      if (!literal)
        return unavailable(
          "This problem does not have a usable embedding yet.",
          200,
        );
      queryEmbedding = literal as unknown as number[];
      currentDifficulty = [1, 2, 3].includes(current.difficulty)
        ? current.difficulty
        : null;
    } else {
      queryEmbedding = await embedQuery(options.query);
    }

    const filterDifficulty =
      options.mode === "easier" &&
      currentDifficulty !== null &&
      currentDifficulty > 1
        ? currentDifficulty - 1
        : options.mode === "harder" &&
            currentDifficulty !== null &&
            currentDifficulty < 3
          ? currentDifficulty + 1
          : options.mode === "related"
            ? options.difficulty
            : null;
    const rpcInput = {
      query_embedding: queryEmbedding,
      match_count: options.limit + 1,
      min_similarity: 0,
      filter_domain: options.domain,
      filter_difficulty: filterDifficulty,
    };
    let { data: matches, error: matchError } = await supabase.rpc(
      "match_problems",
      rpcInput,
    );
    if (matchError)
      return unavailable(
        "Semantic search is temporarily unavailable. The embedding backfill may be incomplete.",
      );
    if (
      (!matches || matches.length === 0) &&
      (options.mode === "easier" || options.mode === "harder")
    ) {
      ({ data: matches, error: matchError } = await supabase.rpc(
        "match_problems",
        { ...rpcInput, filter_difficulty: null },
      ));
      if (matchError)
        return unavailable("Semantic search is temporarily unavailable.");
    }
    const matchRows = ((matches as MatchRow[] | null) ?? []).filter(
      (row) => String(row.problem_id) !== options.problemId,
    );
    const ids = matchRows.map((row) => String(row.problem_id));
    if (!ids.length)
      return NextResponse.json({
        available: true,
        results: [],
        model: embeddingModel,
        dimensions: embeddingDimensions,
      });
    const { data: details, error: detailsError } = await supabase
      .from("problem_search")
      .select("problem_id, content_id, contest_id, primary_topics")
      .in("problem_id", ids);
    if (detailsError)
      return unavailable("Search results are temporarily unavailable.");
    const detailsById = new Map(
      (details ?? []).map((row) => [String(row.problem_id), row]),
    );
    let results = matchRows.map((row) => {
      const detail = detailsById.get(String(row.problem_id));
      return {
        problemId: String(row.problem_id),
        contentId: detail?.content_id ? String(detail.content_id) : null,
        contestId: detail?.contest_id ? String(detail.contest_id) : null,
        name: String(row.name ?? "Untitled problem"),
        difficulty:
          typeof row.difficulty === "number" &&
          [1, 2, 3].includes(row.difficulty)
            ? row.difficulty
            : null,
        topics: Array.isArray(row.topics) ? row.topics : [],
        primaryTopics: Array.isArray(detail?.primary_topics)
          ? detail.primary_topics.slice(0, 4)
          : [],
        domain: row.domain ?? null,
        similarity: Number(Number(row.similarity ?? 0).toFixed(4)),
        completed: false,
        bookmarked: false,
      };
    });
    if (options.topic)
      results = results.filter((result) =>
        [...result.topics, ...result.primaryTopics].some(
          (topic) => String(topic).toLowerCase() === options.topic,
        ),
      );
    try {
      results = await applyPersonalFilters(supabase, results, options);
    } catch (error) {
      return NextResponse.json(
        {
          available: true,
          results: [],
          error:
            error instanceof Error
              ? error.message
              : "Log in to use personal filters.",
        },
        { status: 401 },
      );
    }
    return NextResponse.json({
      available: true,
      results: results.slice(0, options.limit),
      model: embeddingModel,
      dimensions: embeddingDimensions,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Semantic search is temporarily unavailable.";
    if (/configured|embedding|Gemini/i.test(message))
      return unavailable(
        "Semantic search is not configured or its embedding provider is unavailable.",
      );
    return unavailable("Semantic search is temporarily unavailable.");
  }
}
