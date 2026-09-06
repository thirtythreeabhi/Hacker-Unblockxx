"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { IndexedContent, ProblemSearchResult, Question } from "../lib/types";
import DifficultyBadge from "./DifficultyBadge";

type TutorMode = "current" | "corpus";
type CorpusFocus = "related" | "easier" | "harder";
type Message = { role: "user" | "assistant"; text: string; references?: ProblemSearchResult[] };

const currentActions = [
  ["Explain problem", "Explain what this problem asks, without solving it."],
  ["Tiny hint", "Give me one tiny, non-spoiler hint."],
  ["Complexity target", "What time and space complexity should I aim for, based on the supplied constraints?"],
] as const;

export default function AskHackerBlocks({
  contestId,
  question,
  content,
  onOpenReference,
}: {
  contestId: string;
  question: Question;
  content: IndexedContent;
  onOpenReference: (result: ProblemSearchResult) => void;
}) {
  const [mode, setMode] = useState<TutorMode>("current");
  const [focus, setFocus] = useState<CorpusFocus>("related");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(text: string, requestedMode: TutorMode = mode, requestedFocus: CorpusFocus = focus) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    const nextMode = requestedMode;
    const nextFocus = requestedFocus;
    setDraft("");
    setError(null);
    setMessages((current) => [...current, { role: "user", text: trimmed }]);
    setLoading(true);
    try {
      const response = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: nextMode,
          message: trimmed,
          contestId,
          contentId: question.contentId || content.contentId,
          currentProblemId: question.problemId ?? content.problemId,
          focus: nextFocus,
          history: messages.slice(-6).map((item) => `${item.role === "user" ? "User" : "Tutor"}: ${item.text}`).join("\n"),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Ask HackerBlocks is unavailable.");
      setMessages((current) => [...current, { role: "assistant", text: String(body.answer ?? ""), references: Array.isArray(body.references) ? body.references as ProblemSearchResult[] : [] }]);
    } catch (askError: unknown) {
      setError(askError instanceof Error ? askError.message : "Ask HackerBlocks is unavailable.");
    } finally {
      setLoading(false);
    }
  }

  function corpusAction(label: string, action: CorpusFocus) {
    setMode("corpus");
    setFocus(action);
    void ask(label === "Find similar"
      ? `Find problems similar to this current problem, and explain the closest matches.`
      : `Find problems similar to this current problem that are ${action}.`, "corpus", action);
  }

  return (
    <section className="ask-hackerblocks-section" aria-label="Ask HackerBlocks tutor">
      <div className="ask-heading">
        <div><span className="ask-kicker">ASK HACKERBLOCKS</span><h3>Corpus-aware DSA tutor</h3><p>Answers are grounded in this problem or retrieved corpus references.</p></div>
        <span className="ask-session-note">Session only</span>
      </div>
      <div className="ask-mode-tabs" role="tablist" aria-label="Tutor mode">
        <button className={mode === "current" ? "active" : ""} onClick={() => setMode("current")} role="tab" aria-selected={mode === "current"}>Current problem</button>
        <button className={mode === "corpus" ? "active" : ""} onClick={() => setMode("corpus")} role="tab" aria-selected={mode === "corpus"}>Corpus search</button>
      </div>
      <div className="ask-quick-actions">
        {currentActions.map(([label, prompt]) => <button key={label} onClick={() => void ask(prompt, "current", "related")} disabled={loading}>{label}</button>)}
        <button onClick={() => corpusAction("Find similar", "related")} disabled={loading}>Find similar</button>
        <button onClick={() => corpusAction("Find easier", "easier")} disabled={loading}>Find easier</button>
        <button onClick={() => corpusAction("Find harder", "harder")} disabled={loading}>Find harder</button>
      </div>
      {messages.length > 0 && <div className="ask-thread" aria-live="polite">{messages.map((message, index) => <article className={`ask-message ${message.role}`} key={`${message.role}-${index}`}><span className="ask-message-role">{message.role === "user" ? "You" : "HackerBlocks"}</span><div className="ask-message-text">{message.role === "assistant" ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown> : message.text}</div>{message.role === "assistant" && message.references && message.references.length > 0 && <div className="ask-references"><span className="ask-references-label">Grounded references</span>{message.references.map((reference) => <button key={reference.problemId} className="ask-reference" onClick={() => onOpenReference(reference)} disabled={!reference.contestId || !reference.contentId}><span><b>{reference.name}</b><small>#{reference.problemId}{reference.primaryTopics.length ? ` · ${reference.primaryTopics.join(", ")}` : ""}</small></span><DifficultyBadge difficulty={reference.difficulty} /></button>)}</div>}</article>)}</div>}
      {loading && <p className="ai-loading" aria-live="polite">Retrieving trusted context and asking the tutor…</p>}
      {error && <p className="ai-error" role="alert">{error}</p>}
      <form className="ask-form" onSubmit={(event) => { event.preventDefault(); void ask(draft); }}>
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={mode === "current" ? "Ask about this problem…" : "Search the problem corpus…"} rows={2} maxLength={4000} disabled={loading} />
        <button className="primary-button" type="submit" disabled={loading || !draft.trim()}>Ask</button>
      </form>
      <p className="ask-disclaimer">No notes or shared solution artifacts are sent automatically. The tutor does not mark progress.</p>
    </section>
  );
}
