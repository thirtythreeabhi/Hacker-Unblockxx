"use client";

import { useEffect, useState } from "react";
import type { ProblemSearchResult } from "../lib/types";
import { useProgress } from "../lib/progress";
import DifficultyBadge from "./DifficultyBadge";

type Mode = "continue" | "harder" | "bookmarked" | "random" | "weak";

const actions: Array<{ label: string; mode: Mode; limit: number }> = [
  { label: "Give me one", mode: "random", limit: 1 },
  { label: "5 problems", mode: "random", limit: 5 },
  { label: "Same topic", mode: "continue", limit: 5 },
  { label: "Slightly harder", mode: "harder", limit: 5 },
  { label: "Bookmarked + incomplete", mode: "bookmarked", limit: 5 },
];

export default function PracticePanel({ onOpen }: { onOpen: (result: ProblemSearchResult) => void }) {
  const { user, toggleBookmark } = useProgress();
  const [results, setResults] = useState<ProblemSearchResult[]>([]);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState<Mode | null>(null);

  useEffect(() => {
    setResults([]);
    setSkipped(new Set());
    setSeen(new Set());
    setActiveMode(null);
    setError(null);
  }, [user?.id]);

  async function getRecommendations(mode: Mode, limit: number) {
    setActiveMode(mode);
    setSkipped(new Set());
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ mode, limit: String(limit) });
      if (seen.size) params.set("exclude", Array.from(seen).join(","));
      const response = await fetch(`/api/recommendations?${params.toString()}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.available === false) throw new Error(body.error || "Recommendations are unavailable.");
      const nextResults = Array.isArray(body.results) ? body.results as ProblemSearchResult[] : [];
      setResults(nextResults);
      setSeen((current) => new Set([...Array.from(current), ...nextResults.map((result) => result.problemId)]));
    } catch (fetchError: unknown) {
      setResults([]);
      setError(fetchError instanceof Error ? fetchError.message : "Recommendations are unavailable.");
    } finally {
      setLoading(false);
    }
  }

  async function bookmark(result: ProblemSearchResult) {
    if (!result.contentId) return;
    try { await toggleBookmark(result.problemId, result.contentId); } catch (bookmarkError: unknown) { setError(bookmarkError instanceof Error ? bookmarkError.message : "Could not save bookmark."); }
  }

  const visible = results.filter((result) => !skipped.has(result.problemId));

  return (
    <section className="practice-panel">
      <div className="practice-heading"><div><p className="eyebrow">PERSONAL PRACTICE</p><h2>Practice next</h2><p>Deterministic recommendations from your private progress and the shared problem corpus.</p></div>{user ? <span className="practice-private">Private to your account</span> : <a className="secondary-button" href="/login">Log in</a>}</div>
      {user && <div className="practice-actions">{actions.map((action) => <button key={action.label} className={`filter-pill ${activeMode === action.mode && !loading ? "active" : ""}`} onClick={() => void getRecommendations(action.mode, action.limit)} disabled={loading}>{action.label}</button>)}</div>}
      {!user && <p className="practice-muted">Sign in to use completed, bookmarked, and recent-practice signals.</p>}
      {loading && <p className="ai-loading">Building your next practice set…</p>}
      {error && <p className="ai-error" role="alert">{error}</p>}
      {!loading && !error && visible.length > 0 && <div className="practice-list">{visible.map((result) => <article className="practice-item" key={result.problemId}><div className="practice-item-main"><h3>{result.name}</h3><p>#{result.problemId}{result.primaryTopics.length ? ` · ${result.primaryTopics.join(", ")}` : ""}</p><small>{result.reason}</small></div><div className="practice-item-actions"><DifficultyBadge difficulty={result.difficulty} /><button className="secondary-button" onClick={() => onOpen(result)} disabled={!result.contentId || !result.contestId}>Open</button><button className="secondary-button" onClick={() => void bookmark(result)} disabled={!result.contentId}>Bookmark</button><button className="practice-skip" onClick={() => setSkipped((current) => new Set(current).add(result.problemId))}>Skip</button></div></article>)}</div>}
      {!loading && !error && activeMode && visible.length === 0 && <p className="practice-muted">No eligible problems found for this mode yet.</p>}
    </section>
  );
}
