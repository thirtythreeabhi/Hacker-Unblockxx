const API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);
const CACHE_TTL_MS = 5 * 60 * 1000;
const embeddingCache = new Map<string, { values: number[]; expiresAt: number }>();

export const embeddingModel = (process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001").trim();
export const embeddingDimensions = Number.parseInt(process.env.GEMINI_EMBEDDING_DIMENSIONS ?? "768", 10);

function embeddingKeys() {
  return (process.env.GEMINI_API_KEYS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
}

function normalizedQuery(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export async function embedQuery(query: string) {
  const normalized = normalizedQuery(query);
  if (!normalized) throw new Error("Search query is empty.");
  if (!embeddingModel || !Number.isInteger(embeddingDimensions) || embeddingDimensions < 128 || embeddingDimensions > 3072) {
    throw new Error("Semantic search embedding configuration is invalid.");
  }
  const cached = embeddingCache.get(`${embeddingModel}:${embeddingDimensions}:${normalized}`);
  if (cached && cached.expiresAt > Date.now()) return cached.values;
  if (cached) embeddingCache.delete(`${embeddingModel}:${embeddingDimensions}:${normalized}`);
  const keys = embeddingKeys();
  if (!keys.length) throw new Error("Semantic search is not configured on the server.");

  let lastError: Error | null = null;
  const maxRetries = Math.max(2, Number.parseInt(process.env.GEMINI_EMBEDDING_MAX_RETRIES ?? "3", 10) || 3);
  const disabledKeys = new Set<number>();
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const keyIndex = attempt % keys.length;
    if (disabledKeys.has(keyIndex)) continue;
    const key = keys[keyIndex];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(5000, Number.parseInt(process.env.GEMINI_EMBEDDING_TIMEOUT_MS ?? "30000", 10) || 30000));
    try {
      const response = await fetch(`${API_ROOT}/${encodeURIComponent(embeddingModel)}:embedContent?key=${encodeURIComponent(key)}`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `models/${embeddingModel}`, content: { parts: [{ text: query }] }, taskType: "RETRIEVAL_QUERY", outputDimensionality: embeddingDimensions }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(`Gemini embedding request failed with HTTP ${response.status}`);
        (error as Error & { status?: number; transient?: boolean }).status = response.status;
        (error as Error & { status?: number; transient?: boolean }).transient = TRANSIENT_STATUS.has(response.status);
        throw error;
      }
      const values = body?.embedding?.values;
      if (!Array.isArray(values) || values.some((value: unknown) => typeof value !== "number" || !Number.isFinite(value))) throw new Error("Gemini returned an invalid embedding.");
      if (values.length !== embeddingDimensions) throw new Error(`Embedding dimension mismatch: expected ${embeddingDimensions}, received ${values.length}.`);
      embeddingCache.set(`${embeddingModel}:${embeddingDimensions}:${normalized}`, { values, expiresAt: Date.now() + CACHE_TTL_MS });
      return values;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Embedding request failed.");
      const status = (error as { status?: number })?.status;
      const credentialFailure = status === 401 || status === 403;
      if (credentialFailure) disabledKeys.add(keyIndex);
      const retryable = (error as { transient?: boolean })?.transient || (error as { name?: string })?.name === "AbortError" || /network|fetch/i.test(lastError.message);
      if ((!retryable && !credentialFailure) || attempt >= maxRetries - 1) break;
      if (credentialFailure) continue;
      await new Promise((resolve) => setTimeout(resolve, Math.min(30000, 750 * 2 ** attempt)));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError ?? new Error("Embedding request failed.");
}
