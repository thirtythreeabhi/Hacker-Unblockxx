import type { Question, SolutionStub } from "./types";

const API_BASE = "https://hack-api.codingblocks.com/api/v2";

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

const HTML_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
};

export function htmlishToText(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;

  let text = value.replace(/\r\n?/g, "\n");

  text = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<\/li\s*>/gi, "\n")
    .replace(/<\/?(?:p|div|h[1-6])\b[^>]*>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#(?:x[\da-f]+|\d+)|[a-z][a-z\d]+);/gi, (entity, key: string) => {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey in HTML_ENTITIES) return HTML_ENTITIES[normalizedKey];

      if (normalizedKey.startsWith("#x")) {
        const codePoint = Number.parseInt(normalizedKey.slice(2), 16);
        return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : entity;
      }

      if (normalizedKey.startsWith("#")) {
        const codePoint = Number.parseInt(normalizedKey.slice(1), 10);
        return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : entity;
      }

      return entity;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n")
    .trim();

  return text || null;
}

export function normalizeQuestion(payload: any, fallbackContentId: string): Question {
  const content = payload?.data ?? {};
  const contentAttributes = content?.attributes ?? {};
  const problem = Array.isArray(payload?.included)
    ? payload.included.find((resource: any) => resource?.type === "problems")
    : null;
  const problemAttributes = problem?.attributes ?? {};
  const details = problemAttributes.details ?? {};
  const stubsByLanguage = new Map<string, SolutionStub>();
  if (Array.isArray(payload?.included)) {
    for (const resource of payload.included) {
      if (resource?.type !== "solution_stubs" || typeof resource?.attributes?.body !== "string") continue;

      const language = stringOrNull(resource.attributes.language) ?? "unknown";
      const languageKey = language.toLowerCase();
      if (!stubsByLanguage.has(languageKey)) {
        stubsByLanguage.set(languageKey, { language, body: resource.attributes.body });
      }
    }
  }
  const stubs = Array.from(stubsByLanguage.values());

  return {
    contentId: String(content?.id ?? fallbackContentId),
    problemId: problem?.id
      ? String(problem.id)
      : content?.relationships?.problem?.data?.id
        ? String(content.relationships.problem.data.id)
        : null,
    name: String(contentAttributes.name ?? problemAttributes.name ?? "Untitled question"),
    difficulty:
      typeof problemAttributes.difficulty === "number"
        ? problemAttributes.difficulty
        : typeof contentAttributes.difficulty === "number"
          ? contentAttributes.difficulty
          : null,
    description: htmlishToText(details.description),
    constraints: htmlishToText(details.constraints),
    inputFormat: htmlishToText(details.input_format),
    outputFormat: htmlishToText(details.output_format),
    sampleInput: stringOrNull(details.sample_input),
    sampleOutput: stringOrNull(details.sample_output),
    explanation: htmlishToText(details.explanation),
    problemType: stringOrNull(problemAttributes["problem-type"]),
    status: stringOrNull(problemAttributes.status),
    solutionStubs: stubs,
  };
}

export async function fetchQuestion(contentId: string, contestId: string) {
  const url = `${API_BASE}/contents/${contentId}?contest_id=${contestId}&include=problem,quiz,project,web-challenge`;
  return fetch(url, {
    next: { revalidate: 86400 },
    headers: { Accept: "application/vnd.api+json, application/json" },
  });
}
