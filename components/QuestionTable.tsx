import type { IndexedContent } from "../lib/types";
import DifficultyBadge from "./DifficultyBadge";

export default function QuestionTable({
  contents,
  onOpen,
}: {
  contents: IndexedContent[];
  onOpen: (content: IndexedContent) => void;
}) {
  return (
    <div className="question-table-wrap">
      <table className="question-table">
        <thead>
          <tr>
            <th>Content ID</th>
            <th>Problem ID</th>
            <th>Question</th>
            <th>Difficulty</th>
            <th>Type</th>
            <th>Verified</th>
          </tr>
        </thead>
        <tbody>
          {contents.map((content) => (
            <tr
              className="question-row"
              key={`${content.contentId}-${content.problemId ?? "none"}`}
              onClick={() => onOpen(content)}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpen(content);
                }
              }}
            >
              <td className="mono">{content.contentId}</td>
              <td className="mono muted">{content.problemId ?? "—"}</td>
              <td className="question-name-cell">
                <span>{content.name || "Untitled question"}</span>
                <span className="open-arrow">↗</span>
              </td>
              <td><DifficultyBadge difficulty={content.difficulty} /></td>
              <td className="muted">{content.type ?? "—"}</td>
              <td>{content.verified ? <span className="verified">✓ Yes</span> : <span className="muted">No</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
