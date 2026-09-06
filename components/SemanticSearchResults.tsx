"use client";

import type { ProblemSearchResult } from "../lib/types";
import DifficultyBadge from "./DifficultyBadge";

export default function SemanticSearchResults({
  results,
  loading,
  error,
  onOpen,
}: {
  results: ProblemSearchResult[];
  loading: boolean;
  error: string | null;
  onOpen: (result: ProblemSearchResult) => void;
}) {
  return (
    <section className="semantic-results" aria-live="polite">
      {loading && <div className="search-state"><div className="loading-orb" /><p>Finding semantically related problems…</p></div>}
      {!loading && error && <div className="search-state search-state-error"><h3>Semantic search unavailable</h3><p>{error}</p></div>}
      {!loading && !error && results.length === 0 && <div className="search-state"><h3>No semantic matches yet</h3><p>Try another description, or wait until more problem embeddings are available.</p></div>}
      {!loading && !error && results.length > 0 && <div className="semantic-result-list">
        {results.map((result) => (
          <button className="semantic-result" key={`${result.problemId}-${result.contentId ?? ""}`} onClick={() => onOpen(result)} disabled={!result.contestId || !result.contentId}>
            <span className="semantic-result-main"><span className="semantic-result-name">{result.name}</span><span className="semantic-result-meta">#{result.problemId}{result.primaryTopics.length > 0 ? ` · ${result.primaryTopics.join(", ")}` : ""}</span></span>
            <span className="semantic-result-side"><DifficultyBadge difficulty={result.difficulty} /><span className="similarity">{Math.round(result.similarity * 100)}%</span></span>
          </button>
        ))}
      </div>}
    </section>
  );
}
