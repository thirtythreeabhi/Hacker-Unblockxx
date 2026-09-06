"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { IndexData, IndexedContent } from "../lib/types";
import ContestCard from "./ContestCard";
import DifficultyBadge, { difficultyLabel } from "./DifficultyBadge";
import QuestionDrawer from "./QuestionDrawer";
import Stats from "./Stats";

const PAGE_SIZE = 50;

function matchesSearch(contest: IndexData["contests"][number], query: string) {
  if (!query) return true;
  const values = [contest.contestId, contest.contestName, contest.status, ...contest.contents.flatMap((content) => [content.contentId, content.problemId, content.name])];
  return values.some((value) => String(value ?? "").toLowerCase().includes(query));
}

export default function BrowserApp() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [index, setIndex] = useState<IndexData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [openContests, setOpenContests] = useState<Set<string>>(new Set());

  const queryContest = searchParams.get("contest");
  const queryContent = searchParams.get("content");

  useEffect(() => {
    fetch("/data/index.json")
      .then(async (response) => {
        if (!response.ok) throw new Error(`Index could not be loaded (HTTP ${response.status})`);
        return response.json() as Promise<IndexData>;
      })
      .then(setIndex)
      .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : "Index could not be loaded."));
  }, []);

  const filteredContests = useMemo(() => {
    if (!index) return [];
    const query = search.trim().toLowerCase();
    return index.contests.filter((contest) => {
      if (!matchesSearch(contest, query)) return false;
      if (filter === "200") return contest.status === 200;
      if (filter === "403") return contest.status === 403;
      if (["1", "2", "3"].includes(filter)) return contest.contents.some((content) => content.difficulty === Number(filter));
      return true;
    });
  }, [filter, index, search]);

  const totalPages = Math.max(1, Math.ceil(filteredContests.length / PAGE_SIZE));
  const visibleContests = filteredContests.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [filter, search]);

  useEffect(() => {
    if (queryContest) setOpenContests((current) => new Set(current).add(queryContest));
  }, [queryContest]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const selected = useMemo(() => {
    if (!queryContest || !queryContent) return null;
    const contest = index?.contests.find((item) => item.contestId === queryContest);
    const content = contest?.contents.find((item) => item.contentId === queryContent);
    return { contestId: queryContest, content: content ?? ({ contentId: queryContent, problemId: null, name: "Shared question", difficulty: null, type: null, verified: false } satisfies IndexedContent) };
  }, [index, queryContest, queryContent]);

  const closeQuestion = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [pathname, router]);

  function openQuestion(contestId: string, content: IndexedContent) {
    router.replace(`${pathname}?contest=${encodeURIComponent(contestId)}&content=${encodeURIComponent(content.contentId)}`, { scroll: false });
  }

  function toggleContest(contestId: string) {
    setOpenContests((current) => {
      const next = new Set(current);
      if (next.has(contestId)) next.delete(contestId); else next.add(contestId);
      return next;
    });
  }

  const statusText = index ? `Snapshot built ${new Date(index.generatedAt).toLocaleString()}` : "Loading indexed contests…";

  return (
    <main className="app-shell">
      <header className="hero">
        <div className="hero-inner">
          <div className="brand-row">
            <div className="brand-mark">HB</div>
            <span className="brand-label">HACKERBLOCKS / DSA LIBRARY</span>
          </div>
          <div className="hero-copy">
            <div>
              <p className="eyebrow">A searchable contest archive</p>
              <h1>HackerBlocks <span>Browser</span></h1>
              <p className="hero-subtitle">Find a contest. Open a question. Get straight to the problem.</p>
            </div>
            <div className="hero-note"><span className="live-dot" /> Snapshot indexed locally <small>{index ? `${index.stats.contests.toLocaleString()} contests` : "…"}</small></div>
          </div>
          <div className="search-panel">
            <div className="search-wrap">
              <span className="search-icon">⌕</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search contests, questions, content IDs…" aria-label="Search contests and questions" />
              {search && <button className="clear-search" onClick={() => setSearch("")} aria-label="Clear search">×</button>}
              <kbd>⌘ K</kbd>
            </div>
            <div className="filter-row" role="group" aria-label="Filters">
              {["all", "200", "403", "1", "2", "3"].map((value) => (
                <button key={value} className={`filter-pill ${filter === value ? "active" : ""}`} onClick={() => setFilter(value)}>
                  {value === "all" ? "All" : value === "200" ? "HTTP 200" : value === "403" ? "HTTP 403" : difficultyLabel(Number(value) as 1 | 2 | 3)}
                </button>
              ))}
              <span className="result-count">{index ? `${filteredContests.length.toLocaleString()} contests` : "Preparing index…"}</span>
            </div>
          </div>
        </div>
      </header>

      {index && <Stats stats={index.stats} />}

      <section className="content-shell">
        <div className="list-heading">
          <div>
            <p className="eyebrow">CONTESTS</p>
            <h2>{search || filter !== "all" ? "Filtered contests" : "Your problem archive"}</h2>
          </div>
          <p className="snapshot-status">{statusText}</p>
        </div>

        {loadError ? (
          <div className="full-error"><h2>Couldn’t load the contest index</h2><p>{loadError}</p><button className="secondary-button" onClick={() => window.location.reload()}>Reload</button></div>
        ) : !index ? (
          <div className="index-loading"><div className="loading-orb" /><p>Loading your contest archive…</p></div>
        ) : visibleContests.length === 0 ? (
          <div className="empty-state large"><div className="empty-icon">⌕</div><h2>No contests found</h2><p>Try a different search term or filter.</p></div>
        ) : (
          <div className="contest-list">
            {visibleContests.map((contest) => (
              <ContestCard key={contest.contestId} contest={contest} open={openContests.has(contest.contestId)} onToggle={() => toggleContest(contest.contestId)} onOpenQuestion={(content) => openQuestion(contest.contestId, content)} />
            ))}
          </div>
        )}

        {index && totalPages > 1 && (
          <nav className="pagination" aria-label="Contest pages">
            <button className="page-button" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>← Previous</button>
            <span>Page <b>{page}</b> of <b>{totalPages}</b></span>
            <button className="page-button" disabled={page === totalPages} onClick={() => setPage((current) => current + 1)}>Next →</button>
          </nav>
        )}
      </section>

      {selected && <QuestionDrawer contestId={selected.contestId} content={selected.content} onClose={closeQuestion} />}
    </main>
  );
}
