export const geminiKeys = (process.env.GEMINI_API_KEYS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

export const geminiModels = (process.env.GEMINI_MODELS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

export function assertGeminiConfig() {
  if (geminiKeys.length === 0 || geminiModels.length === 0) {
    throw new Error("Gemini is not configured on the server.");
  }
}
