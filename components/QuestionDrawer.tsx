"use client";

import { useEffect, useMemo, useState } from "react";
import type { IndexedContent, Question } from "../lib/types";
import DifficultyBadge from "./DifficultyBadge";

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
  const [question, setQuestion] = useState<Question | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedLanguage, setSelectedLanguage] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    setQuestion(null);
    setError(null);
    setLoading(true);
    setCopied(false);

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
                <button className="secondary-button" onClick={copyLink}>{copied ? "Link copied" : "Copy link"}</button>
                <a className="secondary-button" href={`https://hack.codingblocks.com/app/contests/${contestId}`} target="_blank" rel="noreferrer">Original contest ↗</a>
              </div>
            </div>

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
