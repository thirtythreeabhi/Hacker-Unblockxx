import type { GeminiTask } from "./types";

export type QuestionArtifactInput = {
  title: string;
  description: string | null;
  constraints: string | null;
  inputFormat: string | null;
  outputFormat: string | null;
  sampleInput: string | null;
  sampleOutput: string | null;
  language?: string;
};

function sourceText(input: QuestionArtifactInput) {
  return JSON.stringify({
    title: input.title,
    description: input.description,
    constraints: input.constraints,
    inputFormat: input.inputFormat,
    outputFormat: input.outputFormat,
    sampleInput: input.sampleInput,
    sampleOutput: input.sampleOutput,
  });
}

export function buildPrompt(task: GeminiTask, input: QuestionArtifactInput) {
  const common = `You are generating a practice artifact from one trusted HackerBlocks programming problem. Use ONLY the supplied source fields. Do not invent constraints, sample behavior, hidden tests, audience, or intended solution details. Do not include HackerBlocks solution explanations, starter code, personal notes, progress, or other questions. Return only the requested JSON object. Source:\n${sourceText(input)}`;

  switch (task) {
    case "cleaned_question":
      return `${common}\nTask: Repair formatting and grammar while preserving the exact problem meaning, numbers, constraints, input/output semantics, and official samples. Do not add hints, approaches, algorithm names, or a solution. Return Markdown only in the markdown field.`;
    case "boilerplate":
      return `${common}\nTask: Create immediately pasteable ${input.language ?? "cpp"} boilerplate only. Include imports/includes, input parsing and output plumbing that are directly implied by the source. Use clear TODO markers. Do not implement an algorithm, choose an approach, or reveal a solution.`;
    case "approaches":
      return `${common}\nTask: List materially distinct, useful solution approaches in increasing quality order when supported by the source. Include brute force/intermediate/optimal only when they genuinely apply. Do not include implementation code or pseudocode. Do not claim an approach is valid if the source does not support it.`;
    case "hint_ladder":
      return `${common}\nTask: Create exactly 4 progressively stronger hints. Level 1 is a tiny nudge; level 2 an observation; level 3 a likely technique/data structure; level 4 near-complete reasoning without implementation. Do not include code.`;
    case "generated_tests":
      return `${common}\nTask: Create 3 to 6 clearly AI-generated practice tests based on the visible statement and constraints. Include minimal/boundary, standard, and relevant edge cases where possible. Never claim these are official or hidden HackerBlocks tests.`;
    case "complexity_target":
      return `${common}\nTask: State a likely target time and space complexity from the supplied constraints, with concise reasoning. Do not reveal an algorithm or implementation. If constraints are missing, say that confidence is low.`;
    case "simple_explanation":
      return `${common}\nTask: Explain in plain language what the problem asks, including its inputs, goal, and important details. Do not solve it, give an algorithm, or provide code.`;
  }
}
