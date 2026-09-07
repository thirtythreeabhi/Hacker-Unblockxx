"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { IndexedContent } from "./types";
import { createClient } from "./supabase/client";

export type ProblemProgress = {
  user_id: string;
  problem_id: string;
  content_id: string | null;
  bookmarked: boolean;
  completed: boolean;
  notes: string | null;
  completed_at: string | null;
  created_at?: string;
  updated_at?: string;
};

type ProgressContextValue = {
  user: User | null;
  loading: boolean;
  error: string | null;
  progress: Map<string, ProblemProgress>;
  progressKey: (
    content:
      | Pick<IndexedContent, "problemId" | "contentId">
      | { problemId?: string | null; contentId: string },
  ) => string;
  getProgress: (
    problemId: string | null | undefined,
    contentId: string,
  ) => ProblemProgress | undefined;
  toggleBookmark: (
    problemId: string | null | undefined,
    contentId: string,
  ) => Promise<void>;
  toggleCompleted: (
    problemId: string | null | undefined,
    contentId: string,
  ) => Promise<void>;
  saveNotes: (
    problemId: string | null | undefined,
    contentId: string,
    notes: string,
  ) => Promise<void>;
};

const ProgressContext = createContext<ProgressContextValue | null>(null);

export function getProblemProgressKey(
  problemId: string | null | undefined,
  contentId: string,
) {
  return problemId || contentId;
}

export function ProgressProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [progress, setProgress] = useState<Map<string, ProblemProgress>>(
    new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadProgress(nextUser: User | null) {
      if (!nextUser) {
        if (active) {
          setProgress(new Map());
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      const { data, error: progressError } = await supabase
        .from("problem_progress")
        .select("*")
        .eq("user_id", nextUser.id);

      if (!active) return;
      if (progressError) {
        setError(progressError.message);
        setProgress(new Map());
      } else {
        setError(null);
        setProgress(
          new Map(
            (data as ProblemProgress[]).map((row) => [row.problem_id, row]),
          ),
        );
      }
      setLoading(false);
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUser(data.session?.user ?? null);
      void loadProgress(data.session?.user ?? null);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!active) return;
        setUser(session?.user ?? null);
        void loadProgress(session?.user ?? null);
      },
    );

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [supabase]);

  async function upsert(
    problemId: string | null | undefined,
    contentId: string,
    patch: Partial<
      Pick<
        ProblemProgress,
        "bookmarked" | "completed" | "notes" | "completed_at"
      >
    >,
  ) {
    if (!user) throw new Error("Log in to save your progress.");

    const key = getProblemProgressKey(problemId, contentId);
    const current = progress.get(key);
    const next: ProblemProgress = {
      user_id: user.id,
      problem_id: key,
      content_id: contentId,
      bookmarked: current?.bookmarked ?? false,
      completed: current?.completed ?? false,
      notes: current?.notes ?? null,
      completed_at: current?.completed_at ?? null,
      ...patch,
      updated_at: new Date().toISOString(),
    };

    const previous = new Map(progress);
    setProgress((currentMap) => new Map(currentMap).set(key, next));
    const { error: upsertError } = await supabase
      .from("problem_progress")
      .upsert(next, { onConflict: "user_id,problem_id" });
    if (upsertError) {
      setProgress(previous);
      throw new Error(upsertError.message);
    }
  }

  const value = useMemo<ProgressContextValue>(
    () => ({
      user,
      loading,
      error,
      progress,
      progressKey: (content) =>
        getProblemProgressKey(content.problemId, content.contentId),
      getProgress: (problemId, contentId) =>
        progress.get(getProblemProgressKey(problemId, contentId)),
      toggleBookmark: async (problemId, contentId) => {
        const current = progress.get(
          getProblemProgressKey(problemId, contentId),
        );
        await upsert(problemId, contentId, {
          bookmarked: !(current?.bookmarked ?? false),
        });
      },
      toggleCompleted: async (problemId, contentId) => {
        const current = progress.get(
          getProblemProgressKey(problemId, contentId),
        );
        const completed = !(current?.completed ?? false);
        await upsert(problemId, contentId, {
          completed,
          completed_at: completed ? new Date().toISOString() : null,
        });
      },
      saveNotes: async (problemId, contentId, notes) => {
        await upsert(problemId, contentId, { notes: notes.trim() || null });
      },
    }),
    [error, loading, progress, user],
  );

  return (
    <ProgressContext.Provider value={value}>
      {children}
    </ProgressContext.Provider>
  );
}

export function useProgress() {
  const context = useContext(ProgressContext);
  if (!context)
    throw new Error("useProgress must be used inside ProgressProvider");
  return context;
}
