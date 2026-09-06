"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { IndexedContent, ProblemSearchResult, Question } from "../lib/types";
import { useProgress } from "../lib/progress";
import DifficultyBadge from "./DifficultyBadge";
import AITools from "./AITools";

function TextSection({ title, value }: { title: string; value: string | null }) {
  if (!value) return null;

  return (
    <section className="question-section">
      <h3>{title}</h3>
      <div className="prose-text">{value}</div>
    </section>
  );
}

function CodeBlock({ title, value }: { title: string; value: string | null }) {
  if (!value) return null;
  return (
    <section className="question-section code-section">
      <h3>{title}</h3>
      <pre><code>{value}</code></pre>
    </section>
  );
}

export default function QuestionDrawer({
  contestId,
  content,
  onClose,
}: {
  contestId: string;
  content: IndexedContent;
  onClose: () => void;
}) {
  const router = useRouter();
  const { user, getProgress, toggleBookmark, toggleCompleted, saveNotes } = useProgress();
  const [question, setQuestion] = useState<Question | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedLanguage, setSelectedLanguage] = useState("");
  const [copied, setCopied] = useState(false);
  const [notes, setNotes] = useState("");
  const [savingProgress, setSavingProgress] = useState(false);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [related, setRelated] = useState<ProblemSearchResult[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [relatedMode, setRelatedMode] = useState<"related" | "easier" | "harder">("related");
  const [relatedError, setRelatedError] = useState<string | null>(null);

  const progressProblemId = question?.problemId ?? content.problemId;
  const itemProgress = getProgress(progressProblemId, content.contentId);

  useEffect(() => {
    let active = true;
    setQuestion(null);
    setError(null);
    setLoading(true);
    setCopied(false);
    setNotes("");
    setProgressError(null);

    fetch(`/api/question?contestId=${encodeURIComponent(contestId)}&contentId=${encodeURIComponent(content.contentId)}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || `Question could not be fetched (HTTP ${response.status})`);
        return body as Question;
      })
      .then((body) => {
        if (active) {
          setQuestion(body);
          setSelectedLanguage(body.solutionStubs[0]?.language ?? "");
        }
      })
      .catch((fetchError: unknown) => {
        if (active) setError(fetchError instanceof Error ? fetchError.message : "Question could not be fetched.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [contestId, content.contentId]);

  useEffect(() => {
    setNotes(itemProgress?.notes ?? "");
  }, [itemProgress?.notes, progressProblemId, content.contentId]);

  const loadRelated = useCallback(async (mode: "related" | "easier" | "harder") => {
    if (!question?.problemId) {
      setRelated([]);
      setRelatedError("This question has no canonical problem embedding yet.");
      return;
    }
    setRelatedMode(mode);
    setRelatedLoading(true);
    setRelatedError(null);
    try {
      const response = await fetch(`/api/search/problems?problemId=${encodeURIComponent(question.problemId)}&mode=${mode}&limit=6`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.available === false) throw new Error(body.error || "Related problems are not available yet.");
      setRelated(Array.isArray(body.results) ? body.results as ProblemSearchResult[] : []);
    } catch (fetchError: unknown) {
      setRelated([]);
      setRelatedError(fetchError instanceof Error ? fetchError.message : "Related problems are not available yet.");
    } finally {
      setRelatedLoading(false);
    }
  }, [question?.problemId]);

  useEffect(() => { void loadRelated("related"); }, [loadRelated]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const activeStub = useMemo(
    () => question?.solutionStubs.find((stub) => stub.language === selectedLanguage),
    [question, selectedLanguage],
  );

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  function requireLogin() {
    router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }

  function openRelated(result: ProblemSearchResult) {
    if (result.contestId && result.contentId) router.replace(`/?contest=${encodeURIComponent(result.contestId)}&content=${encodeURIComponent(result.contentId)}`, { scroll: false });
  }

  async function changeProgress(action: "bookmark" | "complete") {
    if (!user) {
      requireLogin();
      return;
    }
    setSavingProgress(true);
    setProgressError(null);
    try {
      if (action === "bookmark") await toggleBookmark(progressProblemId, content.contentId);
      else await toggleCompleted(progressProblemId, content.contentId);
    } catch (actionError: unknown) {
      setProgressError(actionError instanceof Error ? actionError.message : "Progress could not be saved.");
    } finally {
      setSavingProgress(false);
    }
  }

  async function saveNote() {
    if (!user) {
      requireLogin();
      return;
    }
    setSavingProgress(true);
    setProgressError(null);
    try {
      await saveNotes(progressProblemId, content.contentId, notes);
    } catch (actionError: unknown) {
      setProgressError(actionError instanceof Error ? actionError.message : "Note could not be saved.");
    } finally {
      setSavingProgress(false);
    }
  }

  return (
    <div className="drawer-layer" role="presentation">
      <button className="drawer-backdrop" aria-label="Close question" onClick={onClose} />
      <aside className="question-drawer" role="dialog" aria-modal="true" aria-label="Question details">
        <div className="drawer-topbar">
          <span className="eyebrow">QUESTION VIEW</span>
          <button className="icon-button" aria-label="Close question" onClick={onClose}>×</button>
        </div>

        {loading ? (
          <div className="drawer-loading" aria-live="polite">
            <div className="loading-orb" />
            <div className="skeleton skeleton-title" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line short" />
            <div className="skeleton skeleton-block" />
            <p>Fetching the full question…</p>
          </div>
        ) : error ? (
          <div className="drawer-error" role="alert">
            <div className="error-mark">!</div>
            <h2>Unable to open this question</h2>
            <p>{error}</p>
            <button className="secondary-button" onClick={() => window.location.reload()}>Try again</button>
          </div>
        ) : question ? (
          <div className="drawer-content">
            <div className="question-heading">
              <div className="question-kicker">
                <DifficultyBadge difficulty={question.difficulty ?? content.difficulty} />
                {question.problemType && <span className="type-chip">{question.problemType}</span>}
              </div>
              <h2>{question.name}</h2>
              <div className="question-meta">
                <span>Problem <b>#{question.problemId ?? content.problemId ?? "—"}</b></span>
                <span>Content <b>#{question.contentId}</b></span>
              </div>
              <div className="drawer-actions">
                <button className={`secondary-button progress-action ${itemProgress?.bookmarked ? "is-active" : ""}`} onClick={() => void changeProgress("bookmark")} disabled={savingProgress}>{itemProgress?.bookmarked ? "★ Bookmarked" : "☆ Bookmark"}</button>
                <button className={`secondary-button progress-action ${itemProgress?.completed ? "is-active" : ""}`} onClick={() => void changeProgress("complete")} disabled={savingProgress}>{itemProgress?.completed ? "✓ Completed" : "○ Mark completed"}</button>
                <button className="secondary-button" onClick={copyLink}>{copied ? "Link copied" : "Copy link"}</button>
                <a className="secondary-button" href={`https://hack.codingblocks.com/app/contests/${contestId}`} target="_blank" rel="noreferrer">Original contest ↗</a>
              </div>
            </div>

            {progressError && <p className="progress-error" role="alert">{progressError}</p>}
            {user && <section className="question-section notes-section"><h3>Private note</h3><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Add a note for this problem…" rows={4} /><button className="secondary-button" onClick={() => void saveNote()} disabled={savingProgress}>Save note</button></section>}

            <AITools contestId={contestId} question={question} content={content} />

            <section className="related-section">
              <div className="related-heading"><div><h3>Related problems</h3><p>Vector neighbors from the shared problem corpus</p></div><div className="related-actions"><button className={relatedMode === "related" ? "active" : ""} onClick={() => void loadRelated("related")} disabled={relatedLoading}>Related</button><button className={relatedMode === "easier" ? "active" : ""} onClick={() => void loadRelated("easier")} disabled={relatedLoading}>Similar easier</button><button className={relatedMode === "harder" ? "active" : ""} onClick={() => void loadRelated("harder")} disabled={relatedLoading}>Similar harder</button></div></div>
              {relatedLoading && <p className="ai-loading">Finding vector neighbors…</p>}
              {!relatedLoading && relatedError && <p className="ai-muted">{relatedError}</p>}
              {!relatedLoading && !relatedError && related.length === 0 && <p className="ai-muted">No embedded neighbors are available yet.</p>}
              {!relatedLoading && !relatedError && related.length > 0 && <div className="related-list">{related.map((result) => <button className="related-item" key={`${result.problemId}-${result.contentId ?? ""}`} onClick={() => openRelated(result)} disabled={!result.contestId || !result.contentId}><span><b>{result.name}</b><small>#{result.problemId}{result.primaryTopics.length ? ` · ${result.primaryTopics.join(", ")}` : ""}</small></span><span className="related-score"><DifficultyBadge difficulty={result.difficulty} />{Math.round(result.similarity * 100)}%</span></button>)}</div>}
            </section>

            <TextSection title="Description" value={question.description} />
            <TextSection title="Constraints" value={question.constraints} />
            <TextSection title="Input format" value={question.inputFormat} />
            <TextSection title="Output format" value={question.outputFormat} />
            <CodeBlock title="Sample input" value={question.sampleInput} />
            <CodeBlock title="Sample output" value={question.sampleOutput} />
            <TextSection title="Explanation" value={question.explanation} />

            {question.solutionStubs.length > 0 && (
              <section className="question-section starter-section">
                <h3>Starter code</h3>
                <div className="language-tabs" role="tablist" aria-label="Starter code language">
                  {question.solutionStubs.map((stub) => (
                    <button
                      key={stub.language}
                      className={stub.language === selectedLanguage ? "active" : ""}
                      role="tab"
                      aria-selected={stub.language === selectedLanguage}
                      onClick={() => setSelectedLanguage(stub.language)}
                    >{stub.language}</button>
                  ))}
                </div>
                {activeStub && <pre><code>{activeStub.body}</code></pre>}
              </section>
            )}
          </div>
        ) : null}
      </aside>
    </div>
  );
}
