const API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function embeddingConfig() {
  const keys = (process.env.GEMINI_API_KEYS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const model = (process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001").trim();
  const dimensions = Number.parseInt(process.env.GEMINI_EMBEDDING_DIMENSIONS ?? "768", 10);
  if (!keys.length) throw new Error("Set GEMINI_API_KEYS before embedding problems.");
  if (!model) throw new Error("GEMINI_EMBEDDING_MODEL must not be empty.");
  if (!Number.isInteger(dimensions) || dimensions < 128 || dimensions > 3072) throw new Error("GEMINI_EMBEDDING_DIMENSIONS must be an integer from 128 through 3072.");
  return { keys, model, dimensions };
}

export class GeminiEmbeddingClient {
  constructor(config = embeddingConfig()) {
    this.config = config;
    this.nextKey = 0;
  }

  async embed(text, taskType = "RETRIEVAL_DOCUMENT") {
    let lastError = null;
    const maxRetries = Math.max(2, Number.parseInt(process.env.GEMINI_EMBEDDING_MAX_RETRIES ?? "4", 10) || 4);
    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      const keyIndex = this.nextKey++ % this.config.keys.length;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.max(5000, Number.parseInt(process.env.GEMINI_EMBEDDING_TIMEOUT_MS ?? "60000", 10) || 60000));
      try {
        const response = await fetch(`${API_ROOT}/${encodeURIComponent(this.config.model)}:embedContent?key=${encodeURIComponent(this.config.keys[keyIndex])}`, {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: `models/${this.config.model}`, content: { parts: [{ text }] }, taskType, outputDimensionality: this.config.dimensions }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          const error = new Error(`Gemini embedding request failed with HTTP ${response.status}`);
          error.status = response.status;
          error.transient = TRANSIENT_STATUS.has(response.status);
          error.retryAfterMs = Number.parseFloat(response.headers.get("retry-after") ?? "") * 1000;
          throw error;
        }
        const values = body?.embedding?.values;
        if (!Array.isArray(values) || values.some((value) => typeof value !== "number" || !Number.isFinite(value))) throw new Error("Gemini embedding response did not contain numeric values");
        if (values.length !== this.config.dimensions) throw new Error(`Gemini embedding dimension mismatch: expected ${this.config.dimensions}, received ${values.length}`);
        return values;
      } catch (error) {
        lastError = error;
        const transient = error?.transient || error?.name === "AbortError" || /network|fetch/i.test(error?.message ?? "");
        if (!transient || attempt >= maxRetries - 1) break;
        const retryAfter = Number.isFinite(error?.retryAfterMs) && error.retryAfterMs > 0 ? Math.min(120000, error.retryAfterMs) : Math.min(60000, 1000 * 2 ** attempt);
        await sleep(retryAfter);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError ?? new Error("Gemini embedding request failed");
  }
}
