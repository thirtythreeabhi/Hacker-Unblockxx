import type { IndexedContent } from "../lib/types";
import type { ProblemProgress } from "../lib/progress";
import DifficultyBadge from "./DifficultyBadge";

export default function QuestionTable({
  contents,
  onOpen,
  progress,
}: {
  contents: IndexedContent[];
  onOpen: (content: IndexedContent) => void;
  progress: Map<string, ProblemProgress>;
}) {
  return (
    <div className="question-table-wrap">
      <table className="question-table">
        <thead><tr><th>Content ID</th><th>Problem ID</th><th>Question</th><th>Difficulty</th><th>Type</th><th>Verified</th></tr></thead>
        <tbody>
          {contents.map((content) => {
            const itemProgress = progress.get(content.problemId ?? content.contentId);
            const markers = [itemProgress?.bookmarked && "Bookmarked", itemProgress?.completed && "Completed"].filter(Boolean).join(", ");
            return (
              <tr className="question-row" key={`${content.contentId}-${content.problemId ?? "none"}`} onClick={() => onOpen(content)} tabIndex={0} onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(content); }
              }}>
                <td className="mono">{content.contentId}</td>
                <td className="mono muted">{content.problemId ?? "—"}</td>
                <td className="question-name-cell"><span className="progress-markers" aria-label={markers || undefined}>{itemProgress?.bookmarked && <span className="bookmark-marker">★</span>}{itemProgress?.completed && <span className="completed-marker">✓</span>}</span><span>{content.name || "Untitled question"}</span><span className="open-arrow">↗</span></td>
                <td><DifficultyBadge difficulty={content.difficulty} /></td>
                <td className="muted">{content.type ?? "—"}</td>
                <td>{content.verified ? <span className="verified">✓ Yes</span> : <span className="muted">No</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
