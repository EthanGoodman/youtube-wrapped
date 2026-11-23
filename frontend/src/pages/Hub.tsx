/* The landing page: every platform, with links into the ones that have data. */
import { useState } from "react";
import { BarChart3, ChevronDown, Database, ExternalLink, Sparkles } from "lucide-react";
import { PlatformSummary, usePlatforms } from "../api";
import { compact, date, num } from "../format";
import { HubLink } from "../platform";

/** Brand colors for the tiles (each platform's own pages use its full theme). */
export const BRAND: Record<string, { bg: string; fg?: string }> = {
  youtube: { bg: "linear-gradient(140deg,#ff0033,#7a0019)" },
  netflix: { bg: "linear-gradient(140deg,#e50914,#3d0306)" },
  spotify: { bg: "linear-gradient(140deg,#1ed760,#0b5c2a)", fg: "#0b0b0b" },
  prime_video: { bg: "linear-gradient(140deg,#00a8e1,#0b2a4a)" },
  tiktok: { bg: "linear-gradient(140deg,#25f4ee 0%,#111 45%,#fe2c55 100%)" },
  instagram: { bg: "linear-gradient(140deg,#f58529,#dd2a7b 50%,#8134af)" },
  crunchyroll: { bg: "linear-gradient(140deg,#ff640a,#7a2a05)" },
};

export function Hub() {
  const q = usePlatforms();
  const list = q.data ?? [];
  const ready = list.filter((p) => p.has_data);
  const rest = list.filter((p) => !p.has_data);
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 pb-16 pt-12 sm:pt-16">
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-black tracking-tight sm:text-5xl">Wrapped</h1>
        <p className="mt-2 text-sub">Your stats and year-in-review for every app you use. Private, on your machine.</p>
        <HubLink to="/sources" className="mx-auto mt-5 inline-flex items-center gap-1.5 rounded-full bg-raised px-4 py-2 text-sm font-semibold hover:bg-line">
          <Database size={15} /> Data sources
        </HubLink>
      </header>
      {q.data && ready.length === 0 && (
        <section className="mb-10 rounded-2xl bg-card p-6 text-center ring-1 ring-line">
          <h2 className="text-xl font-bold">Start by adding your data</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-sub">Download your history from YouTube, Netflix or another app, then drop the file in. It never leaves this computer.</p>
          <HubLink to="/sources" className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-bg hover:bg-white">
            <Database size={16} /> Add data
          </HubLink>
        </section>
      )}
      {q.error && <p className="text-center text-down">Couldn't reach the server: {q.error.message}</p>}
      {ready.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-muted">Your platforms</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {ready.map((p) => <ReadyTile key={p.id} p={p} />)}
          </div>
        </section>
      )}
      {rest.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-muted">More platforms</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((p) => <SoonTile key={p.id} p={p} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function ReadyTile({ p }: { p: PlatformSummary }) {
  const brand = BRAND[p.id] ?? BRAND.youtube;
  const hours = (p.est_s ?? 0) / 3600;
  return (
    <div className="flex flex-col justify-between overflow-hidden rounded-2xl p-6 shadow-xl"
         style={{ background: brand.bg, color: brand.fg ?? "#fff" }}>
      <div>
        <div className="text-2xl font-black">{p.name}</div>
        <div className="mt-6 flex items-baseline gap-2">
          <span className="text-5xl font-black leading-none">{num(hours)}</span>
          <span className="text-lg font-bold opacity-80">hours{p.capabilities.includes("estimated_time") ? " (est.)" : ""}</span>
        </div>
        <div className="mt-2 text-sm opacity-80">
          {compact(p.items ?? 0)} {p.vocab.items} · since {date(p.first_date)}
        </div>
      </div>
      <div className="mt-6 flex gap-2">
        <HubLink to={`/${p.id}`} className="flex items-center gap-1.5 rounded-full bg-black/80 px-4 py-2 text-sm font-bold text-white hover:bg-black">
          <BarChart3 size={16} /> Stats
        </HubLink>
        <HubLink to={`/${p.id}/wrapped`} className="flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-bold text-black hover:bg-white/90">
          <Sparkles size={16} /> Wrapped
        </HubLink>
      </div>
    </div>
  );
}

function SoonTile({ p }: { p: PlatformSummary }) {
  const [open, setOpen] = useState(false);
  const brand = BRAND[p.id] ?? BRAND.youtube;
  return (
    <div className="rounded-2xl bg-card p-4 ring-1 ring-line">
      <div className="flex items-center gap-3">
        <span className="h-9 w-9 shrink-0 rounded-xl" style={{ background: brand.bg }} />
        <div className="min-w-0 flex-1">
          <div className="font-bold">{p.name}</div>
          <div className="text-xs text-muted">{p.implemented ? <HubLink to="/sources" className="underline underline-offset-2 hover:text-ink">Add your data</HubLink> : "Coming soon"}</div>
        </div>
        {p.issue && (
          <a href={`https://github.com/EthanGoodman/youtube-wrapped/issues/${p.issue}`} target="_blank" rel="noreferrer"
             className="flex items-center gap-1 text-xs text-sub hover:text-ink">#{p.issue} <ExternalLink size={12} /></a>
        )}
      </div>
      {!p.implemented && <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
              className="mt-3 flex w-full items-center justify-between text-xs font-medium text-sub hover:text-ink">
        How to get your data <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>}
      {open && (
        <div className="mt-2 text-xs text-sub">
          <ol className="list-decimal space-y-1 pl-4">
            {p.export_steps.map((s) => <li key={s}>{s}</li>)}
          </ol>
          {p.export_wait && <p className="mt-2 text-muted">Takes {p.export_wait}.</p>}
        </div>
      )}
    </div>
  );
}
