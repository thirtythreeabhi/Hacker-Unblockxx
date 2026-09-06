export type GeminiTask =
  | "cleaned_question"
  | "boilerplate"
  | "approaches"
  | "hint_ladder"
  | "generated_tests"
  | "complexity_target"
  | "simple_explanation"
  | "tutor";

export type GeminiSchema = Record<string, unknown>;

export type GeminiGeneration = {
  payload: unknown;
  model: string;
};
