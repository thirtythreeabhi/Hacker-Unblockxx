import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { fetchQuestion, normalizeQuestion } from "../../../../lib/question";
import { createClient as createUserClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { generateWithGemini } from "../../../../lib/gemini/executor";
import { validateArtifact } from "../../../../lib/gemini/schemas";
import type { GeminiTask } from "../../../../lib/gemini/types";

const ARTIFACT_TYPES = ["cleaned_question", "boilerplate", "approaches", "generated_tests", "hint_ladder", "complexity_target", "simple_explanation"] as const;
const LANGUAGES = ["cpp", "py3", "java", "js", "c"] as const;
type ArtifactType = typeof ARTIFACT_TYPES[number];

function isNumericId(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

function sourceHash(question: ReturnType<typeof normalizeQuestion>, language: string | null) {
  return createHash("sha256").update(JSON.stringify({
    title: question.name,
    description: question.description,
    constraints: question.constraints,
    inputFormat: question.inputFormat,
    outputFormat: question.outputFormat,
    sampleInput: question.sampleInput,
    sampleOutput: question.sampleOutput,
    ...(language ? { language } : {}),
  })).digest("hex");
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

function isArtifactType(value: unknown): value is ArtifactType {
  return typeof value === "string" && ARTIFACT_TYPES.includes(value as ArtifactType);
}

async function loadQuestion(contestId: string, contentId: string) {
  const upstream = await fetchQuestion(contentId, contestId);
  if (!upstream.ok) throw new Error(`Question could not be fetched (HTTP ${upstream.status})`);
  return normalizeQuestion(await upstream.json(), contentId);
}

async function cachedArtifact(client: Awaited<ReturnType<typeof createUserClient>>, problemId: string, artifactType: ArtifactType, language: string | null, hash: string) {
  let query = client.from("ai_problem_artifacts").select("id,problem_id,content_id,artifact_type,language,source_hash,payload,model,created_at,updated_at").eq("problem_id", problemId).eq("artifact_type", artifactType).eq("source_hash", hash);
  query = language ? query.eq("language", language) : query.is("language", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

const inFlight = new Map<string, Promise<unknown>>();

export async function POST(request: Request) {
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }

  const contestId = body?.contestId;
  const contentId = body?.contentId;
  const artifactType = body?.artifactType;
  const regenerate = body?.regenerate === true;
  if (!isNumericId(contestId) || !isNumericId(contentId) || !isArtifactType(artifactType)) return NextResponse.json({ error: "contestId, contentId, and a valid artifactType are required." }, { status: 400 });

  const language = artifactType === "boilerplate" ? (typeof body?.language === "string" && LANGUAGES.includes(body.language as typeof LANGUAGES[number]) ? body.language : "cpp") : null;
  if (artifactType === "boilerplate" && body?.language && !language) return NextResponse.json({ error: "Unsupported boilerplate language." }, { status: 400 });

  try {
    const userClient = await createUserClient();
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ error: "Log in to use AI tools." }, { status: 401 });

    const question = await loadQuestion(contestId, contentId);
    const problemId = question.problemId || question.contentId || contentId;
    const hash = sourceHash(question, language);
    if (!regenerate) {
      const cached = await cachedArtifact(userClient, problemId, artifactType, language, hash);
      if (cached) return NextResponse.json({ artifact: cached.payload, cached: true, model: cached.model, sourceHash: hash });
    }

    const key = `${problemId}:${artifactType}:${language ?? ""}:${hash}`;
    const generation = async () => {
      const generated = await generateWithGemini({ task: artifactType as GeminiTask, input: sourceInput(question), language: language ?? undefined });
      const payload = validateArtifact(artifactType as GeminiTask, generated.payload, language ?? undefined);
      const admin = createAdminClient();
      const record = { problem_id: problemId, content_id: question.contentId, artifact_type: artifactType, language, source_hash: hash, payload, model: generated.model, created_by: user.id };
      const { data, error } = await admin.from("ai_problem_artifacts").upsert(record, { onConflict: "problem_id,artifact_type,language_key,source_hash" }).select("payload,model,source_hash").single();
      if (error) throw new Error(error.message);
      return { artifact: data.payload, cached: false, model: data.model, sourceHash: data.source_hash };
    };

    if (!regenerate) {
      const existing = inFlight.get(key);
      if (existing) return NextResponse.json(await existing);
      const pending = generation();
      inFlight.set(key, pending);
      try { return NextResponse.json(await pending); } finally { inFlight.delete(key); }
    }
    return NextResponse.json(await generation());
  } catch (error: any) {
    const message = error instanceof Error ? error.message : "AI artifact could not be generated.";
    const status = /log in/i.test(message) ? 401 : /Question could not be fetched/.test(message) ? 502 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
