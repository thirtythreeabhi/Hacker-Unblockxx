import { NextResponse } from "next/server";
import { fetchQuestion, normalizeQuestion } from "../../../lib/question";

function isNumericId(value: string | null) {
  return Boolean(value && /^\d+$/.test(value));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const contestId = url.searchParams.get("contestId");
  const contentId = url.searchParams.get("contentId");

  if (!isNumericId(contestId) || !isNumericId(contentId)) {
    return NextResponse.json(
      { error: "contestId and contentId must be numeric" },
      { status: 400 },
    );
  }

  const validatedContestId = contestId as string;
  const validatedContentId = contentId as string;

  try {
    const upstream = await fetchQuestion(validatedContentId, validatedContestId);

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Question could not be fetched (HTTP ${upstream.status})` },
        { status: upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502 },
      );
    }

    const payload = await upstream.json();
    return NextResponse.json(normalizeQuestion(payload, validatedContentId), {
      headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=3600" },
    });
  } catch {
    return NextResponse.json(
      { error: "Question could not be fetched right now. Please try again." },
      { status: 502 },
    );
  }
}
