import { useStats } from "../api";
import { MonthlyBars } from "../components/charts";
import { PageTitle, QueryState, Section, StatTile } from "../components/ui";
import { clockTime, date, num } from "../format";
import { rangeLabel, useFilters } from "../filters";

interface SearchStats {
  available: boolean;
  searches: number;
  unique: number;
  top_searches: { query: string; count: number }[];
  top_terms: { term: string; count: number }[];
  per_month: { month: string; count: number }[];
  first_in_range: { query: string; local_iso: string } | null;
  first_ever: { query: string; local_iso: string };
}

export function Search() {
  const { filters } = useFilters();
  const s = useStats<SearchStats>("search", { limit: 30 });
  // search history can start years before watch history, so "Lifetime" means all of it here
  const period = filters.range === "all" ? "all time" : rangeLabel(filters);
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Search history" subtitle={`What you searched for on YouTube, from ${period}`} />
      <QueryState q={s} minHeight={400}>
        {(d) => !d.available ? (
          <div className="card text-sm text-sub">
            No search history imported. Put <code className="text-ink">search-history.json</code> from your Takeout in the
            <code className="text-ink"> data/</code> folder and run <code className="text-ink">python backend/cli.py ingest</code>.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
              <StatTile label="Searches" value={num(d.searches)} />
              <StatTile label="Different searches" value={num(d.unique)} />
              <StatTile label="Your first search ever" value={<span className="text-xl">“{d.first_ever.query}”</span>}
                        hint={`${date(d.first_ever.local_iso)} · ${clockTime(d.first_ever.local_iso)}`} />
              <StatTile label="First search in this period" value={<span className="text-xl">{d.first_in_range ? `“${d.first_in_range.query}”` : "–"}</span>}
                        hint={d.first_in_range ? date(d.first_in_range.local_iso) : undefined} />
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Section title="Top searches" subtitle="Exact searches, most repeated">
                <ol className="flex flex-col gap-1.5">
                  {d.top_searches.map((t, i) => {
                    const max = d.top_searches[0]?.count || 1;
                    return (
                      <li key={t.query} className="relative flex h-9 items-center overflow-hidden rounded-lg">
                        <div className="absolute inset-y-0 left-0 rounded-lg bg-yt-soft/25" style={{ width: `${Math.max(3, (t.count / max) * 100)}%` }} />
                        <span className="relative w-8 text-center text-sm font-black text-sub">{i + 1}</span>
                        <span className="relative min-w-0 flex-1 truncate text-sm font-medium">{t.query}</span>
                        <span className="relative px-3 text-xs text-sub tabular">{num(t.count)}×</span>
                      </li>
                    );
                  })}
                </ol>
              </Section>
              <div className="flex flex-col gap-4">
                <Section title="Most-searched words" subtitle="Single words across all your searches">
                  <div className="flex flex-wrap gap-2">
                    {d.top_terms.map((t, i) => (
                      <span key={t.term} className="chip cursor-default hover:bg-raised"
                            style={{ fontSize: `${Math.max(12, 20 - i * 0.3)}px` }}>
                        {t.term} <span className="text-xs text-sub">{num(t.count)}</span>
                      </span>
                    ))}
                  </div>
                </Section>
                <Section title="Searches per month">
                  <MonthlyBars data={d.per_month.map((m) => ({ ...m, time_s: 0 }))} measure="count" height={220} />
                </Section>
              </div>
            </div>
          </div>
        )}
      </QueryState>
    </div>
  );
}
