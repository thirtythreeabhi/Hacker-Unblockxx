"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { IndexData, IndexedContent } from "../lib/types";
import { useProgress } from "../lib/progress";
import ContestCard from "./ContestCard";
import { difficultyLabel } from "./DifficultyBadge";
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
  const { user, loading: progressLoading, error: progressError, progress, getProgress } = useProgress();
  const [index, setIndex] = useState<IndexData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [difficultyFilter, setDifficultyFilter] = useState("all");
  const [progressFilter, setProgressFilter] = useState("all");
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

    return index.contests.flatMap((contest) => {
      if (!matchesSearch(contest, query)) return [];
      if (statusFilter !== "all" && contest.status !== Number(statusFilter)) return [];
      const contestNameMatches = Boolean(query && [contest.contestId, contest.contestName, contest.status].some((value) => String(value ?? "").toLowerCase().includes(query)));
      const contents = contest.contents.filter((content) => {
        const searchMatches = !query || contestNameMatches || [content.contentId, content.problemId, content.name].some((value) => String(value ?? "").toLowerCase().includes(query));
        const difficultyMatches = difficultyFilter === "all" || content.difficulty === Number(difficultyFilter);
        const itemProgress = getProgress(content.problemId, content.contentId);
        const progressMatches = !user || progressFilter === "all"
          || (progressFilter === "bookmarked" && itemProgress?.bookmarked)
          || (progressFilter === "completed" && itemProgress?.completed)
          || (progressFilter === "incomplete" && !itemProgress?.completed)
          || (progressFilter === "bookmarked-incomplete" && itemProgress?.bookmarked && !itemProgress.completed);
        return searchMatches && difficultyMatches && progressMatches;
      });
      return contents.length > 0 ? [{ ...contest, contents, contentCount: contents.length }] : [];
    });
  }, [difficultyFilter, getProgress, index, progressFilter, search, statusFilter, user]);

  const totalPages = Math.max(1, Math.ceil(filteredContests.length / PAGE_SIZE));
  const visibleContests = filteredContests.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [difficultyFilter, progressFilter, search, statusFilter]);
  useEffect(() => { if (queryContest) setOpenContests((current) => new Set(current).add(queryContest)); }, [queryContest]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const selected = useMemo(() => {
    if (!queryContest || !queryContent) return null;
    const contest = index?.contests.find((item) => item.contestId === queryContest);
    const content = contest?.contents.find((item) => item.contentId === queryContent);
    return { contestId: queryContest, content: content ?? ({ contentId: queryContent, problemId: null, name: "Shared question", difficulty: null, type: null, verified: false } satisfies IndexedContent) };
  }, [index, queryContest, queryContent]);

  const closeQuestion = useCallback(() => router.replace(pathname, { scroll: false }), [pathname, router]);

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

  async function logout() {
    const { createClient } = await import("../lib/supabase/client");
    await createClient().auth.signOut();
  }

  const statusText = index ? `Snapshot built ${new Date(index.generatedAt).toLocaleString()}` : "Loading indexed contests…";
  const signedInLabel = progressLoading ? "Checking account…" : user ? (user.email ?? "Signed in") : "Not signed in";

  return (
    <main className="app-shell">
      <header className="hero">
        <div className="hero-inner">
          <div className="brand-row"><div className="brand-mark">HB</div><span className="brand-label">HACKERBLOCKS / DSA LIBRARY</span><div className="account-area">{user ? <><span className="account-email" title={user.email ?? undefined}>{signedInLabel}</span><button className="account-button" onClick={logout}>Log out</button></> : <><span className="account-email">{signedInLabel}</span><a className="account-button" href="/login">Log in</a><a className="account-button account-primary" href="/signup">Sign up</a></>}</div></div>
          <div className="hero-copy"><div><p className="eyebrow">A searchable contest archive</p><h1>HackerBlocks <span>Browser</span></h1><p className="hero-subtitle">Find a contest. Open a question. Get straight to the problem.</p></div><div className="hero-note"><span className="live-dot" /> Snapshot indexed locally <small>{index ? `${index.stats.contests.toLocaleString()} contests` : "…"}</small></div></div>
          <div className="search-panel">
            <div className="search-wrap"><span className="search-icon">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search contests, questions, content IDs…" aria-label="Search contests and questions" />{search && <button className="clear-search" onClick={() => setSearch("")} aria-label="Clear search">×</button>}<kbd>⌘ K</kbd></div>
            <div className="filter-row" role="group" aria-label="Contest filters">
              {[["all", "All"], ["200", "HTTP 200"], ["403", "HTTP 403"]].map(([value, label]) => <button key={value} className={`filter-pill ${statusFilter === value ? "active" : ""}`} onClick={() => setStatusFilter(value)}>{label}</button>)}
              {[["all", "Any difficulty"], ["1", difficultyLabel(1)], ["2", difficultyLabel(2)], ["3", difficultyLabel(3)]].map(([value, label]) => <button key={`difficulty-${value}`} className={`filter-pill ${difficultyFilter === value ? "active" : ""}`} onClick={() => setDifficultyFilter(value)}>{label}</button>)}
            </div>
            <div className="filter-row progress-filter-row" role="group" aria-label="Progress filters">
              {[['all', 'All progress'], ['bookmarked', '★ Bookmarked'], ['completed', '✓ Completed'], ['incomplete', '○ Incomplete'], ['bookmarked-incomplete', '★ + incomplete']].map(([value, label]) => <button key={value} className={`filter-pill ${progressFilter === value ? "active" : ""}`} onClick={() => setProgressFilter(value)}>{label}</button>)}
              <span className="result-count">{index ? `${filteredContests.length.toLocaleString()} contests` : "Preparing index…"}</span>
            </div>
          </div>
        </div>
      </header>
      {index && <Stats stats={index.stats} />}
      <section className="content-shell">
        <div className="list-heading"><div><p className="eyebrow">CONTESTS</p><h2>{search || statusFilter !== "all" || difficultyFilter !== "all" || progressFilter !== "all" ? "Filtered contests" : "Your problem archive"}</h2></div><p className="snapshot-status">{statusText}</p></div>
        {progressError && user && <p className="progress-error">Progress could not be loaded: {progressError}</p>}
        {!user && progressFilter !== "all" && <div className="login-hint">Log in to use progress filters. <a href={`/login?next=${encodeURIComponent(pathname)}`}>Log in</a></div>}
        {loadError ? <div className="full-error"><h2>Couldn’t load the contest index</h2><p>{loadError}</p><button className="secondary-button" onClick={() => window.location.reload()}>Reload</button></div> : !index ? <div className="index-loading"><div className="loading-orb" /><p>Loading your contest archive…</p></div> : visibleContests.length === 0 ? <div className="empty-state large"><div className="empty-icon">⌕</div><h2>No contests found</h2><p>{!user && progressFilter !== "all" ? "Log in to see your saved progress." : "Try a different search term or filter."}</p></div> : <div className="contest-list">{visibleContests.map((contest) => <ContestCard key={contest.contestId} contest={contest} open={openContests.has(contest.contestId)} onToggle={() => toggleContest(contest.contestId)} onOpenQuestion={(content) => openQuestion(contest.contestId, content)} progress={progress} />)}</div>}
        {index && totalPages > 1 && <nav className="pagination" aria-label="Contest pages"><button className="page-button" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>← Previous</button><span>Page <b>{page}</b> of <b>{totalPages}</b></span><button className="page-button" disabled={page === totalPages} onClick={() => setPage((current) => current + 1)}>Next →</button></nav>}
      </section>
      {selected && <QuestionDrawer contestId={selected.contestId} content={selected.content} onClose={closeQuestion} />}
    </main>
  );
}
