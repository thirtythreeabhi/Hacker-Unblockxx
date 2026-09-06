import { NextResponse } from "next/server";
import { embedQuery } from "../../../lib/gemini/embedding";
import { generateWithGemini } from "../../../lib/gemini/executor";
import { validateArtifact } from "../../../lib/gemini/schemas";
import { fetchQuestion, normalizeQuestion } from "../../../lib/question";
import { createClient } from "../../../lib/supabase/server";
import type { Difficulty, ProblemSearchResult } from "../../../lib/types";

export const runtime = "nodejs";

type TutorMode = "current" | "corpus";
type CorpusFocus = "related" | "easier" | "harder";

type MatchRow = {
  problem_id: string | number;
  name: string | null;
  difficulty: number | null;
  topics: unknown;
  domain: string | null;
  similarity: number | null;
};

function numericId(value: unknown) {
  return typeof value === "string" && /^\d+$/.test(value) ? value : null;
}

function validDifficulty(value: unknown): Difficulty {
  return typeof value === "number" && [1, 2, 3].includes(value) ? value as Difficulty : null;
}

function asStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 12) : [];
}

function vectorLiteral(value: unknown) {
  if (Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item))) return `[${value.join(",")}]`;
  if (typeof value === "string" && /^\[[\d.eE+\-, ]+\]$/.test(value)) return value;
  return null;
}

function progressIsRelevant(message: string) {
  return /\b(progress|completed|complete|bookmarked|bookmark|weak|revisit|attempted)\b/i.test(message);
}

function difficultyLabel(difficulty: Difficulty) {
  return difficulty === 1 ? "easy" : difficulty === 2 ? "medium" : difficulty === 3 ? "hard" : "unknown";
}

async function progressFor(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, ids: string[]) {
  if (!ids.length) return new Map<string, { completed: boolean; bookmarked: boolean }>();
  const { data, error } = await supabase
    .from("problem_progress")
    .select("problem_id, completed, bookmarked")
    .eq("user_id", userId)
    .in("problem_id", ids);
  if (error) return new Map<string, { completed: boolean; bookmarked: boolean }>();
  return new Map((data ?? []).map((row) => [String(row.problem_id), { completed: row.completed === true, bookmarked: row.bookmarked === true }]));
}

function progressSummary(progress: Map<string, { completed: boolean; bookmarked: boolean }>) {
  const values = Array.from(progress.values());
  const completed = values.filter((item) => item.completed).length;
  const bookmarked = values.filter((item) => item.bookmarked && !item.completed).length;
  return `Among the retrieved/current problem references: ${completed} completed; ${bookmarked} bookmarked and incomplete. No private notes are available to the tutor.`;
}

function sourceInput(question: ReturnType<typeof normalizeQuestion>) {
  return {
    title: question.name,
    description: question.description,
    constraints: question.constraints,
    inputFormat: question.inputFormat,
    outputFormat: question.outputFormat,
    sampleInput: question.sampleInput,
    sampleOutput: question.sampleOutput,
  };
}

function errorResponse(message: string, status = 503) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return errorResponse("Send a JSON tutor request.", 400);
  }

  const mode = body.mode === "corpus" ? "corpus" : body.mode === "current" ? "current" : null;
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const history = typeof body.history === "string" ? body.history.trim().slice(0, 12000) : undefined;
  if (!mode || !message || message.length > 4000) return errorResponse("mode and a message up to 4000 characters are required.", 400);

  const contestId = numericId(body.contestId);
  const contentId = numericId(body.contentId);
  if (mode === "current" && (!contestId || !contentId)) return errorResponse("Current-problem mode requires numeric contestId and contentId.", 400);

  const currentProblemId = numericId(body.currentProblemId);
  const focus: CorpusFocus = body.focus === "easier" || body.focus === "harder" ? body.focus : "related";

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) return errorResponse("Log in to use Ask HackerBlocks.", 401);

    if (mode === "current") {
      const upstream = await fetchQuestion(contentId as string, contestId as string);
      if (!upstream.ok) return errorResponse(`Question could not be fetched (HTTP ${upstream.status}).`, upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502);
      const question = normalizeQuestion(await upstream.json(), contentId as string);
      const progress = progressIsRelevant(message) && question.problemId
        ? await progressFor(supabase, authData.user.id, [question.problemId])
        : new Map<string, { completed: boolean; bookmarked: boolean }>();
      const generated = await generateWithGemini({
        task: "tutor",
        input: {
          ...sourceInput(question),
          tutorMode: "current",
          userMessage: message,
          conversationHistory: history,
          progressSummary: progress.size ? progressSummary(progress) : undefined,
        },
      });
      const artifact = validateArtifact("tutor", generated.payload);
      return NextResponse.json({ answer: String(artifact.answer), references: [], mode, model: generated.model });
    }

    let queryEmbedding: number[] | string;
    let currentDifficulty: Difficulty = null;
    if (currentProblemId) {
      const { data: current, error: currentError } = await supabase.from("problem_search").select("embedding, difficulty").eq("problem_id", currentProblemId).maybeSingle();
      if (currentError) return errorResponse("Corpus search is not available until the search migration is applied.");
      const literal = vectorLiteral(current?.embedding);
      if (!literal) return NextResponse.json({ answer: "This problem does not have a usable corpus embedding yet, so I cannot search for grounded matches.", references: [], mode, retrievalCount: 0 });
      queryEmbedding = literal;
      currentDifficulty = validDifficulty(current?.difficulty);
    } else {
      queryEmbedding = await embedQuery(message);
    }

    const filterDifficulty = focus === "easier" && currentDifficulty !== null && currentDifficulty > 1
      ? currentDifficulty - 1
      : focus === "harder" && currentDifficulty !== null && currentDifficulty < 3
        ? currentDifficulty + 1
        : null;
    const { data: matches, error: matchError } = await supabase.rpc("match_problems", {
      query_embedding: queryEmbedding,
      match_count: 8,
      min_similarity: 0,
      filter_domain: null,
      filter_difficulty: filterDifficulty,
    });
    if (matchError) return errorResponse("Corpus search is temporarily unavailable.");

    const matchRows = ((matches as MatchRow[] | null) ?? []).filter((row) => String(row.problem_id) !== currentProblemId);
    const ids = matchRows.map((row) => String(row.problem_id));
    if (!ids.length) return NextResponse.json({ answer: "No grounded corpus matches were found for that request.", references: [], mode, retrievalCount: 0 });

    const { data: details, error: detailsError } = await supabase
      .from("problem_search")
      .select("problem_id, content_id, contest_id, description, primary_topics")
      .in("problem_id", ids);
    if (detailsError) return errorResponse("Corpus references are temporarily unavailable.");
    const detailsById = new Map((details ?? []).map((row) => [String(row.problem_id), row]));
    const progress = progressIsRelevant(message) ? await progressFor(supabase, authData.user.id, ids) : new Map<string, { completed: boolean; bookmarked: boolean }>();
    const references: ProblemSearchResult[] = matchRows.map((row) => {
      const id = String(row.problem_id);
      const detail = detailsById.get(id);
      const saved = progress.get(id) ?? { completed: false, bookmarked: false };
      return {
        problemId: id,
        contentId: detail?.content_id ? String(detail.content_id) : null,
        contestId: detail?.contest_id ? String(detail.contest_id) : null,
        name: String(row.name ?? "Untitled problem"),
        difficulty: validDifficulty(row.difficulty),
        topics: asStrings(row.topics),
        primaryTopics: asStrings(detail?.primary_topics).slice(0, 4),
        domain: row.domain ?? null,
        similarity: Number(Number(row.similarity ?? 0).toFixed(4)),
        completed: saved.completed,
        bookmarked: saved.bookmarked,
      };
    });
    const retrievedContext = references.map((reference) => {
      const detail = detailsById.get(reference.problemId);
      const description = typeof detail?.description === "string" ? detail.description.replace(/\s+/g, " ").trim().slice(0, 500) : "";
      return [
        `Problem #${reference.problemId}: ${reference.name}`,
        `difficulty=${difficultyLabel(reference.difficulty)}`,
        `topics=${reference.primaryTopics.length ? reference.primaryTopics.join(", ") : reference.topics.join(", ") || "unknown"}`,
        `domain=${reference.domain ?? "unknown"}`,
        `contest=${reference.contestId ?? "unknown"}; content=${reference.contentId ?? "unknown"}`,
        description ? `description=${description}` : null,
        `similarity=${reference.similarity}`,
        reference.completed || reference.bookmarked ? `userStatus=${reference.completed ? "completed" : "bookmarked"}` : null,
      ].filter(Boolean).join(" | ");
    }).join("\n");
    const generated = await generateWithGemini({
      task: "tutor",
      input: {
        title: "Corpus search",
        description: null,
        constraints: null,
        inputFormat: null,
        outputFormat: null,
        sampleInput: null,
        sampleOutput: null,
        tutorMode: "corpus",
        userMessage: message,
        conversationHistory: history,
        retrievedContext,
        progressSummary: progress.size ? progressSummary(progress) : undefined,
      },
    });
    const artifact = validateArtifact("tutor", generated.payload);
    return NextResponse.json({ answer: String(artifact.answer), references, mode, model: generated.model, retrievalCount: references.length });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Ask HackerBlocks is temporarily unavailable.";
    if (/configured|Gemini|embedding/i.test(messageText)) return errorResponse("Ask HackerBlocks is not configured or its AI provider is unavailable.");
    return errorResponse("Ask HackerBlocks is temporarily unavailable.");
  }
}
