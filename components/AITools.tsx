"use client";

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Question, IndexedContent } from "../lib/types";

type ArtifactType = "cleaned_question" | "boilerplate" | "approaches" | "generated_tests" | "hint_ladder" | "complexity_target" | "simple_explanation";
type ToolKey = ArtifactType | "context";
type ArtifactEntry = { artifact: Record<string, unknown>; cached: boolean; model: string | null };

const tools: Array<{ key: ArtifactType; label: string; loading: string }> = [
  { key: "cleaned_question", label: "✨ Clean", loading: "Cleaning…" },
  { key: "boilerplate", label: "📋 Boilerplate", loading: "Generating boilerplate…" },
  { key: "approaches", label: "🧠 Approaches", loading: "Finding approaches…" },
  { key: "hint_ladder", label: "💡 Hints", loading: "Generating hints…" },
  { key: "generated_tests", label: "🧪 Tests", loading: "Generating tests…" },
  { key: "complexity_target", label: "🎯 Complexity", loading: "Finding target…" },
  { key: "simple_explanation", label: "Explain simply", loading: "Explaining…" },
];
const languages = ["cpp", "py3", "java", "js", "c"];

function text(value: unknown) { return typeof value === "string" ? value : ""; }

function markdown(value: string) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>;
}

function contextFor(question: Question) {
  return [
    `Problem: ${question.name}`,
    `Description:\n${question.description ?? ""}`,
    `Constraints:\n${question.constraints ?? ""}`,
    `Input Format:\n${question.inputFormat ?? ""}`,
    `Output Format:\n${question.outputFormat ?? ""}`,
    `Official Sample Input:\n${question.sampleInput ?? ""}`,
    `Official Sample Output:\n${question.sampleOutput ?? ""}`,
  ].join("\n\n");
}

export default function AITools({ contestId, question, content }: { contestId: string; question: Question; content: IndexedContent }) {
  const [activeTool, setActiveTool] = useState<ToolKey | null>(null);
  const [artifacts, setArtifacts] = useState<Record<string, ArtifactEntry>>({});
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState("cpp");
  const [revealedHints, setRevealedHints] = useState(1);
  const [copied, setCopied] = useState<string | null>(null);

  const source = useMemo(() => contextFor(question), [question]);
  const artifactKey = (type: ArtifactType, selectedLanguage = language) => type === "boilerplate" ? `${type}:${selectedLanguage}` : type;
  const activeKey = activeTool && activeTool !== "context" ? artifactKey(activeTool) : null;
  const activeArtifact = activeKey ? artifacts[activeKey] : undefined;
  const activeToolLabel = tools.find((tool) => tool.key === activeTool);

  async function fetchArtifact(type: ArtifactType, regenerate = false, selectedLanguage = language) {
    const key = artifactKey(type, selectedLanguage);
    setActiveTool(type);
    setError(null);
    if (!regenerate && artifacts[key]) {
      if (type === "hint_ladder") setRevealedHints(1);
      return;
    }
    setLoadingKey(key);
    try {
      const response = await fetch("/api/question/artifact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contestId, contentId: question.contentId, artifactType: type, language: selectedLanguage, regenerate }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "AI artifact could not be generated.");
      setArtifacts((current) => ({ ...current, [key]: { artifact: body.artifact, cached: body.cached === true, model: body.model ?? null } }));
      if (type === "hint_ladder") setRevealedHints(1);
    } catch (fetchError: unknown) {
      setError(fetchError instanceof Error ? fetchError.message : "AI artifact could not be generated.");
    } finally {
      setLoadingKey(null);
    }
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1600);
    } catch { setCopied(null); }
  }

  function renderArtifact() {
    if (!activeTool || activeTool === "context") return null;
    if (!activeArtifact) return <p className="ai-empty">Select the tool again to generate this artifact.</p>;
    const payload = activeArtifact.artifact;
    if (activeTool === "cleaned_question") return <div className="ai-markdown">{markdown(text(payload.markdown))}</div>;
    if (activeTool === "boilerplate") return <><div className="ai-code-actions"><span className="ai-meta">AI boilerplate · {text(payload.language)}</span><button className="secondary-button" onClick={() => void copy(text(payload.code), "code")}>{copied === "code" ? "Copied" : "Copy code"}</button></div><pre><code>{text(payload.code)}</code></pre>{text(payload.notes) && <p className="ai-note">{text(payload.notes)}</p>}</>;
    if (activeTool === "approaches") return <div className="ai-list">{(Array.isArray(payload.approaches) ? payload.approaches : []).map((item, index) => { const row = item as Record<string, unknown>; return <article className="ai-item" key={`${text(row.name)}-${index}`}><h4>{text(row.name)}</h4><p>{text(row.idea)}</p><div className="ai-complexity"><span>Time: {text(row.timeComplexity)}</span><span>Space: {text(row.spaceComplexity)}</span></div><p className="ai-muted"><b>Useful when:</b> {text(row.whenUseful)} <b>Tradeoffs:</b> {text(row.tradeoffs)}</p></article>; })}</div>;
    if (activeTool === "hint_ladder") { const hints = Array.isArray(payload.hints) ? payload.hints : []; return <div className="ai-list">{hints.slice(0, revealedHints).map((item) => { const row = item as Record<string, unknown>; return <article className="ai-item hint-item" key={String(row.level)}><span className="hint-level">Level {String(row.level)}</span><p>{text(row.text)}</p></article>; })}{revealedHints < hints.length && <button className="secondary-button" onClick={() => setRevealedHints((value) => value + 1)}>Reveal next hint</button>}</div>; }
    if (activeTool === "generated_tests") return <><p className="ai-warning">AI-generated test cases · Generated for practice and may contain mistakes. These are not official test cases.</p><div className="ai-list">{(Array.isArray(payload.tests) ? payload.tests : []).map((item, index) => { const row = item as Record<string, unknown>; return <article className="ai-item" key={`${text(row.name)}-${index}`}><h4>{text(row.name)}</h4><pre><code>{text(row.input)}</code></pre><p><b>Expected output</b></p><pre><code>{text(row.expectedOutput)}</code></pre><p className="ai-muted">{text(row.explanation)}</p><button className="secondary-button" onClick={() => void copy(text(row.input), `test-${index}`)}>{copied === `test-${index}` ? "Copied" : "Copy input"}</button></article>; })}</div></>;
    if (activeTool === "complexity_target") return <div className="ai-callout"><p><b>Time:</b> {text(payload.targetTimeComplexity)}</p><p><b>Space:</b> {text(payload.targetSpaceComplexity)}</p><p>{text(payload.reasoning)}</p><span className="ai-meta">Confidence {Math.round(Number(payload.confidence ?? 0) * 100)}%</span></div>;
    return <div className="ai-callout"><p>{text(payload.summary)}</p><p><b>Inputs:</b> {text(payload.inputs)}</p><p><b>Goal:</b> {text(payload.goal)}</p>{Array.isArray(payload.importantDetails) && <ul>{payload.importantDetails.map((detail, index) => <li key={index}>{text(detail)}</li>)}</ul>}</div>;
  }

  return (
    <section className="ai-tools-section">
      <div className="ai-tools-heading"><div><h3>AI tools</h3><p>Shared, on-demand practice artifacts</p></div><button className="secondary-button" onClick={() => { setActiveTool("context"); void copy(source, "context"); }}>{copied === "context" ? "Context copied" : "Copy AI context"}</button></div>
      <div className="ai-tool-tabs" role="toolbar" aria-label="AI tools">
        <button className={activeTool === null || activeTool === "context" ? "active" : ""} onClick={() => setActiveTool(null)}>Original</button>
        {tools.map((tool) => <button key={tool.key} className={activeTool === tool.key ? "active" : ""} onClick={() => void fetchArtifact(tool.key)} disabled={loadingKey !== null}>{tool.label}</button>)}
      </div>
      {activeTool === "boilerplate" && <div className="ai-language-row"><label>Language <select value={language} onChange={(event) => { setLanguage(event.target.value); void fetchArtifact("boilerplate", false, event.target.value); }}>{languages.map((item) => <option key={item}>{item}</option>)}</select></label></div>}
      {loadingKey && <p className="ai-loading" aria-live="polite">{activeToolLabel?.loading ?? "Generating…"}</p>}
      {error && <div className="ai-error" role="alert">{error} <button className="secondary-button" onClick={() => activeTool && activeTool !== "context" ? void fetchArtifact(activeTool, false) : undefined}>Retry</button></div>}
      {activeTool && activeTool !== "context" && !loadingKey && activeArtifact && <div className="ai-artifact-panel"><div className="ai-artifact-top"><span className="ai-meta">{activeArtifact.cached ? "Shared cached artifact" : "Generated just now"}{activeArtifact.model ? ` · ${activeArtifact.model}` : ""}</span><div className="ai-artifact-actions"><button className="secondary-button" onClick={() => void fetchArtifact(activeTool, true)}>Regenerate</button>{activeTool === "cleaned_question" && <button className="secondary-button" onClick={() => void copy(text(activeArtifact.artifact.markdown), "clean")}>{copied === "clean" ? "Clean context copied" : "Copy clean context"}</button>}</div></div>{renderArtifact()}</div>}
    </section>
  );
}
