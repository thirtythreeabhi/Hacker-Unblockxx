import type { IndexedContest, IndexedContent } from "../lib/types";
import QuestionTable from "./QuestionTable";
import type { ProblemProgress } from "../lib/progress";

function statusLabel(status: number | null) {
  return status === 200 ? "HTTP 200" : status === 403 ? "HTTP 403" : `HTTP ${status ?? "—"}`;
}

export default function ContestCard({
  contest,
  open,
  onToggle,
  onOpenQuestion,
  progress,
}: {
  contest: IndexedContest;
  open: boolean;
  onToggle: () => void;
  onOpenQuestion: (content: IndexedContent) => void;
  progress: Map<string, ProblemProgress>;
}) {
  const statusClass = contest.status === 200 ? "status-ok" : contest.status === 403 ? "status-denied" : "status-other";

  return (
    <section className={`contest-card ${open ? "is-open" : ""}`}>
      <button className="contest-header" onClick={onToggle} aria-expanded={open}>
        <span className="contest-id">#{contest.contestId}</span>
        <span className={`status-badge ${statusClass}`}>{statusLabel(contest.status)}</span>
        <span className="contest-title">{contest.contestName}</span>
        <span className="contest-count">{contest.contentCount.toLocaleString()} {contest.contentCount === 1 ? "question" : "questions"}</span>
        <span className="chevron" aria-hidden="true">{open ? "⌃" : "⌄"}</span>
      </button>

      {open && (
        <div className="contest-contents">
          {contest.status !== 200 ? (
            <div className="empty-state">Questions are unavailable for this contest ({statusLabel(contest.status)}).</div>
          ) : contest.contents.length === 0 ? (
            <div className="empty-state">No questions were returned for this contest.</div>
          ) : (
            <QuestionTable contents={contest.contents} onOpen={onOpenQuestion} progress={progress} />
          )}
        </div>
      )}
    </section>
  );
}
