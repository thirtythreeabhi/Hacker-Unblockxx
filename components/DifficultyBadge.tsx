import type { Difficulty } from "../lib/types";

const labels: Record<Exclude<Difficulty, null>, string> = {
  1: "Easy",
  2: "Medium",
  3: "Hard",
};

export default function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  if (!difficulty || !labels[difficulty]) return <span className="muted">—</span>;
  return <span className={`difficulty difficulty-${difficulty}`}>{labels[difficulty]}</span>;
}

export function difficultyLabel(difficulty: Difficulty) {
  return difficulty ? labels[difficulty] ?? "Unknown" : "Unknown";
}
