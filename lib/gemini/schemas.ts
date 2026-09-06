import type { GeminiSchema, GeminiTask } from "./types";

const stringField = { type: "STRING" };
const nullableStringField = { type: "STRING", nullable: true };

export const artifactSchemas: Record<GeminiTask, GeminiSchema> = {
  cleaned_question: { type: "OBJECT", properties: { markdown: stringField }, required: ["markdown"] },
  boilerplate: { type: "OBJECT", properties: { language: stringField, code: stringField, notes: nullableStringField }, required: ["language", "code", "notes"] },
  approaches: { type: "OBJECT", properties: { approaches: { type: "ARRAY", items: { type: "OBJECT", properties: { name: stringField, idea: stringField, timeComplexity: stringField, spaceComplexity: stringField, whenUseful: stringField, tradeoffs: stringField }, required: ["name", "idea", "timeComplexity", "spaceComplexity", "whenUseful", "tradeoffs"] } } }, required: ["approaches"] },
  hint_ladder: { type: "OBJECT", properties: { hints: { type: "ARRAY", items: { type: "OBJECT", properties: { level: { type: "INTEGER" }, text: stringField }, required: ["level", "text"] } } }, required: ["hints"] },
  generated_tests: { type: "OBJECT", properties: { tests: { type: "ARRAY", items: { type: "OBJECT", properties: { name: stringField, input: stringField, expectedOutput: stringField, explanation: stringField }, required: ["name", "input", "expectedOutput", "explanation"] } } }, required: ["tests"] },
  complexity_target: { type: "OBJECT", properties: { targetTimeComplexity: stringField, targetSpaceComplexity: stringField, reasoning: stringField, confidence: { type: "NUMBER" } }, required: ["targetTimeComplexity", "targetSpaceComplexity", "reasoning", "confidence"] },
  simple_explanation: { type: "OBJECT", properties: { summary: stringField, inputs: stringField, goal: stringField, importantDetails: { type: "ARRAY", items: stringField } }, required: ["summary", "inputs", "goal", "importantDetails"] },
  tutor: { type: "OBJECT", properties: { answer: stringField }, required: ["answer"] },
};

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function objectPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Gemini returned an invalid artifact object.");
  return value as Record<string, unknown>;
}

export function validateArtifact(task: GeminiTask, value: unknown, language?: string) {
  const payload = objectPayload(value);
  if (task === "cleaned_question" && !nonEmptyString(payload.markdown)) throw new Error("Cleaned question was empty.");
  if (task === "boilerplate" && (!nonEmptyString(payload.code) || payload.language !== language)) throw new Error("Boilerplate response was invalid.");
  if (task === "approaches") {
    if (!Array.isArray(payload.approaches) || payload.approaches.length === 0 || payload.approaches.length > 8) throw new Error("Approaches response was invalid.");
    for (const item of payload.approaches) {
      const row = objectPayload(item);
      if (!["name", "idea", "timeComplexity", "spaceComplexity", "whenUseful", "tradeoffs"].every((key) => nonEmptyString(row[key]))) throw new Error("Approach entry was invalid.");
    }
  }
  if (task === "hint_ladder") {
    if (!Array.isArray(payload.hints) || payload.hints.length !== 4) throw new Error("Hint ladder must contain four hints.");
    payload.hints.forEach((item, index) => {
      const row = objectPayload(item);
      if (row.level !== index + 1 || !nonEmptyString(row.text)) throw new Error("Hint entry was invalid.");
    });
  }
  if (task === "generated_tests") {
    if (!Array.isArray(payload.tests) || payload.tests.length < 3 || payload.tests.length > 6) throw new Error("Generated tests response was invalid.");
    payload.tests.forEach((item) => {
      const row = objectPayload(item);
      if (!["name", "input", "expectedOutput", "explanation"].every((key) => nonEmptyString(row[key]))) throw new Error("Generated test entry was invalid.");
    });
  }
  if (task === "complexity_target" && (!["targetTimeComplexity", "targetSpaceComplexity", "reasoning"].every((key) => nonEmptyString(payload[key])) || typeof payload.confidence !== "number")) throw new Error("Complexity response was invalid.");
  if (task === "simple_explanation" && (!["summary", "inputs", "goal"].every((key) => nonEmptyString(payload[key])) || !Array.isArray(payload.importantDetails))) throw new Error("Simple explanation response was invalid.");
  if (task === "tutor" && (!nonEmptyString(payload.answer) || String(payload.answer).length > 12000)) throw new Error("Tutor response was invalid.");
  return payload;
}
