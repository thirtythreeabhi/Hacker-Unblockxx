import { assertGeminiConfig, geminiKeys, geminiModels } from "./config";
import { buildPrompt, type QuestionArtifactInput } from "./prompts";
import { artifactSchemas } from "./schemas";
import type { GeminiGeneration, GeminiTask } from "./types";

const API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseResponse(body: any) {
  const text = (body?.candidates?.[0]?.content?.parts ?? [])
    .map((part: any) => part?.text ?? "")
    .join("")
    .trim();
  const withoutFence = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(withoutFence);
}

export async function generateWithGemini({
  task,
  input,
  language,
}: {
  task: GeminiTask;
  input: QuestionArtifactInput;
  language?: string;
}): Promise<GeminiGeneration> {
  assertGeminiConfig();
  const timeoutMs = Math.max(
    10000,
    Number.parseInt(process.env.GEMINI_REQUEST_TIMEOUT_MS ?? "45000", 10) ||
      45000,
  );
  const maxRetries = Math.max(
    1,
    Number.parseInt(process.env.GEMINI_INTERACTIVE_RETRIES ?? "2", 10) || 2,
  );
  let lastError: Error | null = null;

  for (let keyIndex = 0; keyIndex < geminiKeys.length; keyIndex++) {
    for (let modelIndex = 0; modelIndex < geminiModels.length; modelIndex++) {
      const model = geminiModels[modelIndex];
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(
            `${API_ROOT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKeys[keyIndex])}`,
            {
              method: "POST",
              signal: controller.signal,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [
                  {
                    role: "user",
                    parts: [
                      { text: buildPrompt(task, { ...input, language }) },
                    ],
                  },
                ],
                generationConfig: {
                  temperature: 0.1,
                  responseMimeType: "application/json",
                  responseSchema: artifactSchemas[task],
                },
              }),
            },
          );
          const body = await response.json().catch(() => ({}));
          if (!response.ok) {
            const retryAfter = Number.parseFloat(
              response.headers.get("retry-after") ?? "",
            );
            const error = Object.assign(
              new Error(`Gemini request failed with HTTP ${response.status}`),
              {
                status: response.status,
                transient: TRANSIENT_STATUS.has(response.status),
                retryAfterMs: Number.isFinite(retryAfter)
                  ? Math.min(60000, Math.max(1000, retryAfter * 1000))
                  : null,
              },
            );
            throw error;
          }
          const payload = parseResponse(body);
          return { payload, model };
        } catch (error: any) {
          lastError =
            error instanceof Error
              ? error
              : new Error("Gemini request failed.");
          const transient =
            error?.transient ||
            error?.name === "AbortError" ||
            /JSON|response|network|fetch/i.test(error?.message ?? "");
          if (!transient || attempt >= maxRetries - 1) break;
          await sleep(
            error?.retryAfterMs ?? Math.min(15000, 1000 * 2 ** attempt),
          );
        } finally {
          clearTimeout(timeout);
        }
      }
    }
  }
  throw lastError ?? new Error("All configured Gemini models failed.");
}
