export type RecommendationProblem = {
  problemId: string;
  contentId: string | null;
  contestId: string | null;
  name: string;
  difficulty: 1 | 2 | 3 | null;
  topics: string[];
  primaryTopics: string[];
  domain: string | null;
  embedding: number[] | null;
};

export type RecommendationProgress = {
  problemId: string;
  bookmarked: boolean;
  completed: boolean;
  completedAt: string | null;
  updatedAt: string | null;
};

export type RecommendationMode =
  "continue" | "harder" | "bookmarked" | "random" | "weak";

export type Recommendation = RecommendationProblem & {
  similarity: number | null;
  reason: string;
};

export type NearDuplicatePair = { problemIdA: string; problemIdB: string };

export function parseEmbedding(value: unknown): number[] | null {
  if (Array.isArray(value))
    return value.every(
      (item) => typeof item === "number" && Number.isFinite(item),
    )
      ? value
      : null;
  if (typeof value !== "string" || !/^\[[\d.eE+\-, ]+\]$/.test(value))
    return null;
  const values = value.slice(1, -1).split(",").map(Number);
  return values.length > 0 && values.every(Number.isFinite) ? values : null;
}

export function cosineSimilarity(
  left: number[] | null,
  right: number[] | null,
) {
  if (!left || !right || left.length !== right.length || left.length === 0)
    return null;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : null;
}

function topicSet(problem: RecommendationProblem) {
  return new Set(
    [...problem.primaryTopics, ...problem.topics].map((topic) =>
      topic.toLowerCase(),
    ),
  );
}

function sharedTopicCount(
  left: RecommendationProblem,
  right: RecommendationProblem,
) {
  const rightTopics = topicSet(right);
  return Array.from(topicSet(left)).filter((topic) => rightTopics.has(topic))
    .length;
}

function pairKey(left: string, right: string) {
  return [left, right].sort((a, b) => a.localeCompare(b)).join(":");
}

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1)
    result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return result >>> 0;
}

function nearDuplicateSet(pairs: NearDuplicatePair[]) {
  return new Set(
    pairs.map((pair) =>
      pairKey(String(pair.problemIdA), String(pair.problemIdB)),
    ),
  );
}

function isNearDuplicate(left: string, right: string, pairs: Set<string>) {
  return pairs.has(pairKey(left, right));
}

function recentCompleted(progress: RecommendationProgress[]) {
  return progress
    .filter((row) => row.completed)
    .sort((left, right) =>
      String(right.completedAt ?? right.updatedAt ?? "").localeCompare(
        String(left.completedAt ?? left.updatedAt ?? ""),
      ),
    )
    .slice(0, 3);
}

export function buildRecommendations({
  problems,
  progress,
  mode,
  currentProblemId = null,
  topic = null,
  limit = 5,
  nearDuplicates = [],
  seed = "today",
  excludeProblemIds = [],
}: {
  problems: RecommendationProblem[];
  progress: RecommendationProgress[];
  mode: RecommendationMode;
  currentProblemId?: string | null;
  topic?: string | null;
  limit?: number;
  nearDuplicates?: NearDuplicatePair[];
  seed?: string;
  excludeProblemIds?: string[];
}) {
  const progressById = new Map(progress.map((row) => [row.problemId, row]));
  const pairSet = nearDuplicateSet(nearDuplicates);
  const current = currentProblemId
    ? (problems.find((problem) => problem.problemId === currentProblemId) ??
      null)
    : null;
  const recent = recentCompleted(progress)
    .map((row) =>
      problems.find((problem) => problem.problemId === row.problemId),
    )
    .filter((problem): problem is RecommendationProblem => Boolean(problem));
  const references = current ? [current] : recent;
  const completedCountByTopic = new Map<string, number>();
  for (const row of progress.filter((item) => item.completed)) {
    const problem = problems.find(
      (candidate) => candidate.problemId === row.problemId,
    );
    for (const itemTopic of problem ? Array.from(topicSet(problem)) : [])
      completedCountByTopic.set(
        itemTopic,
        (completedCountByTopic.get(itemTopic) ?? 0) + 1,
      );
  }
  const normalizedTopic = topic?.trim().toLowerCase() || null;
  const excluded = new Set(excludeProblemIds);
  const incomplete = problems.filter((problem) => {
    const saved = progressById.get(problem.problemId);
    if (
      saved?.completed ||
      problem.problemId === currentProblemId ||
      excluded.has(problem.problemId)
    )
      return false;
    if (normalizedTopic && !topicSet(problem).has(normalizedTopic))
      return false;
    return true;
  });
  let candidates = incomplete;
  if (mode === "bookmarked")
    candidates = candidates.filter(
      (problem) => progressById.get(problem.problemId)?.bookmarked === true,
    );
  const scored = candidates.map((problem) => {
    const referenceScores = references
      .map((reference) =>
        cosineSimilarity(problem.embedding, reference.embedding),
      )
      .filter((value): value is number => value !== null);
    const similarity = referenceScores.length
      ? Math.max(...referenceScores)
      : null;
    const bestReference =
      references.find(
        (reference) =>
          cosineSimilarity(problem.embedding, reference.embedding) ===
          similarity,
      ) ??
      references[0] ??
      null;
    const sharedTopics = bestReference
      ? sharedTopicCount(problem, bestReference)
      : 0;
    const saved = progressById.get(problem.problemId);
    let score = similarity ?? 0;
    let reason = "Useful incomplete practice";
    if (mode === "continue") {
      if (!references.length)
        score = hash(`${seed}:${problem.problemId}`) / 0xffffffff;
      score += sharedTopics * 0.025;
      reason = current
        ? "Similar to this concept"
        : references.length > 1
          ? `Similar to ${references.length} problems you completed`
          : references.length === 1
            ? "Similar to a problem you completed"
            : "No recent concept recorded; useful incomplete practice";
    } else if (mode === "harder") {
      if (!references.length)
        score = hash(`${seed}:${problem.problemId}`) / 0xffffffff;
      score += sharedTopics * 0.025;
      if (
        bestReference &&
        problem.difficulty !== null &&
        bestReference.difficulty !== null &&
        problem.difficulty > bestReference.difficulty
      )
        score += 0.08;
      reason =
        bestReference &&
        problem.difficulty !== null &&
        bestReference.difficulty !== null &&
        problem.difficulty === bestReference.difficulty + 1
          ? "Same topic, one difficulty level higher"
          : references.length
            ? "Similar practice at a higher difficulty"
            : "No recent difficulty recorded; useful incomplete practice";
    } else if (mode === "bookmarked") {
      score = Date.parse(saved?.updatedAt ?? "") || 0;
      reason = "Bookmarked and still incomplete";
    } else if (mode === "weak") {
      const topics = Array.from(topicSet(problem));
      const bookmarkedSignal = saved?.bookmarked ? 1 : 0;
      const weakness = topics.length
        ? Math.max(
            ...topics.map(
              (itemTopic) =>
                1 / (1 + (completedCountByTopic.get(itemTopic) ?? 0)),
            ),
          )
        : 0;
      score =
        bookmarkedSignal * 2 +
        weakness +
        (hash(`${seed}:${problem.problemId}`) / 0xffffffff) * 0.01;
      reason = bookmarkedSignal
        ? "Based on bookmarked incomplete topics"
        : "Topic with fewer recorded completions";
    } else {
      score = hash(`${seed}:${problem.problemId}`) / 0xffffffff;
      reason = "Random useful incomplete practice";
    }
    return { problem, similarity, score, reason };
  });
  scored.sort(
    (left, right) =>
      right.score - left.score ||
      left.problem.problemId.localeCompare(right.problem.problemId),
  );

  const adjacentDifficulty =
    mode === "harder" && references.length > 0
      ? new Set(
          references
            .filter(
              (reference) =>
                reference.difficulty !== null && reference.difficulty < 3,
            )
            .map((reference) => reference.difficulty! + 1),
        )
      : new Set<number>();
  const adjacent = adjacentDifficulty.size
    ? scored.filter(
        (item) =>
          item.problem.difficulty !== null &&
          adjacentDifficulty.has(item.problem.difficulty),
      )
    : [];
  const ordered =
    mode === "harder" && adjacent.length
      ? adjacent.concat(scored.filter((item) => !adjacent.includes(item)))
      : scored;
  const selected: Recommendation[] = [];
  for (const item of ordered) {
    if (selected.length >= Math.min(10, Math.max(1, limit))) break;
    if (
      references.some((reference) =>
        isNearDuplicate(reference.problemId, item.problem.problemId, pairSet),
      )
    )
      continue;
    if (
      selected.some((chosen) =>
        isNearDuplicate(chosen.problemId, item.problem.problemId, pairSet),
      )
    )
      continue;
    selected.push({
      ...item.problem,
      similarity:
        item.similarity === null ? null : Number(item.similarity.toFixed(4)),
      reason: item.reason,
    });
  }
  return selected;
}
