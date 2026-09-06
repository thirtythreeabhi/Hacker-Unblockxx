import type { IndexData } from "../lib/types";

export default function Stats({ stats }: { stats: IndexData["stats"] }) {
  const items = [
    [stats.contests, "contests indexed", "violet"],
    [stats.accessibleContests, "accessible contests", "green"],
    [stats.deniedContests, "inaccessible / 403", "red"],
    [stats.memberships, "contest-content memberships", "blue"],
    [stats.uniqueContents, "unique content IDs", "gold"],
    [stats.uniqueProblems, "unique problem IDs", "pink"],
  ] as const;

  return (
    <div className="stats" aria-label="Index statistics">
      {items.map(([value, label, tone]) => (
        <div className={`stat stat-${tone}`} key={label}>
          <strong>{value.toLocaleString()}</strong>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}
