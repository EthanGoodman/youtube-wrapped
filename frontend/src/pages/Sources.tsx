/* Data sources: add, refresh and delete each platform's data from the browser. */
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, FileUp, KeyRound, Loader2, RefreshCw, Search, Trash2, X } from "lucide-react";
import { ApiError, DataSource, Job, sendJson, uploadFile, useSources } from "../api";
import { compact, date } from "../format";
import { HubLink } from "../platform";
import { BRAND } from "./Hub";

const STEP_LABEL: Record<Job["step"], string> = {
  ingest: "Importing", build: "Rebuilding", enrich: "Looking up details", fetch: "Fetching history",
};

function ago(iso: string | null): string {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} minutes ago`;
  if (s < 129600) return `${Math.round(s / 3600)} hours ago`;
  return date(iso.slice(0, 10));
}

export function Sources() {
  const q = useSources();
  const qc = useQueryClient();
  const running = useRef<Set<string>>(new Set());

  // when a job finishes, everything that reads that platform's data is stale
  useEffect(() => {
    const now = new Set((q.data?.sources ?? []).filter((s) => s.job?.state === "running").map((s) => s.id));
    const finished = [...running.current].some((id) => !now.has(id));
    running.current = now;
    if (finished) qc.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "sources" });
  }, [q.data, qc]);

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-4 pb-20 pt-8 sm:pt-12">
      <HubLink to="/" className="text-sm text-sub hover:text-ink">‹ All platforms</HubLink>
      <header className="mb-8 mt-4">
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Data sources</h1>
        <p className="mt-2 break-words text-sub">
          Add your history from each app. Everything stays on this computer: exports and databases in
          <code className="mx-1 rounded bg-raised px-1.5 py-0.5 text-xs">data/</code>, keys in {q.data?.keychain ?? "your OS keychain"}.
        </p>
      </header>
      {q.error && <p className="text-down">Couldn't reach the server: {q.error.message}</p>}
      <div className="space-y-4">
        {q.data?.sources.map((s) => <SourceCard key={s.id} s={s} keychain={q.data.keychain} />)}
      </div>
      {q.data && <DeleteEverything />}
    </div>
  );
}

function SourceCard({ s, keychain }: { s: DataSource; keychain: string }) {
  const qc = useQueryClient();
  const brand = BRAND[s.id] ?? { bg: "rgb(var(--c-raised))" };
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const running = s.job?.state === "running";
  const keysSet = s.secrets.every((x) => x.set);
  const refresh = () => qc.invalidateQueries({ queryKey: ["sources"] });

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
    refresh();
  }

  const upload = (file: File) => act(async () => {
    setProgress(0);
    try {
      await uploadFile(`/api/sources/${s.id}/upload`, file, setProgress);
    } finally {
      setProgress(null);
    }
  });
  const run = (step: Job["step"]) => act(() => sendJson("POST", `/api/sources/${s.id}/run/${step}`));

  return (
    <section className="rounded-2xl bg-card p-5 ring-1 ring-line">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 h-10 w-10 shrink-0 rounded-xl" style={{ background: brand.bg }} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold">{s.name}</h2>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.official ? "bg-raised text-sub" : "bg-[#f5a524]/15 text-[#f5a524]"}`}
                  title={s.official ? "Uses the platform's own data export" : "The platform has no export; this reads your history from its website"}>
              {s.official ? "Official export" : "Unofficial method"}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-sub">
            {s.status.has_data
              ? <>{compact(s.status.rows)} entries · {date(s.status.first_date)} – {date(s.status.last_date)} · updated {ago(s.status.built_at)}</>
              : "Not added yet"}
          </p>
        </div>
      </div>

      <Steps s={s} />

      {s.can.upload && <DropZone disabled={running || progress !== null} progress={progress} onFile={upload} />}

      {s.secrets.map((sec) => <SecretRow key={sec.name} sec={sec} keychain={keychain} onChange={refresh} />)}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {s.can.fetch && (
          <Button onClick={() => run("fetch")} disabled={running} primary>
            <RefreshCw size={15} /> {s.status.has_data ? "Fetch again" : "Fetch history"}
          </Button>
        )}
        {s.can.upload && s.status.files > 0 && (
          <Button onClick={() => run("ingest")} disabled={running}><RefreshCw size={15} /> Import again</Button>
        )}
        {s.can.enrich && s.status.has_data && (
          <Button onClick={() => run("enrich")} disabled={running || !keysSet}
                  title={keysSet ? "Posters, runtimes and genres from public sources" : "Save the key above first"}>
            <Search size={15} /> Look up details
          </Button>
        )}
        {(s.status.has_data || s.status.files > 0) && !confirm && (
          <button onClick={() => setConfirm(true)} disabled={running}
                  className="ml-auto flex items-center gap-1.5 rounded-full px-3 py-2 text-sm text-sub hover:text-down disabled:opacity-40">
            <Trash2 size={15} /> Delete data
          </button>
        )}
      </div>

      {confirm && (
        <Confirm
          text={<>Delete all {s.name} data? This removes its database, everything in <code>{s.folder}</code> (your
            exports and uploads){s.secrets.length ? " and its saved keys" : ""}. Your {s.name} stats are gone until you add the data again.</>}
          action={`Delete ${s.name} data`}
          onCancel={() => setConfirm(false)}
          onConfirm={() => act(async () => {
            await sendJson("DELETE", `/api/sources/${s.id}`);
            setConfirm(false);
            qc.invalidateQueries();
          })}
        />
      )}

      {error && <p className="mt-3 flex items-start gap-2 text-sm text-down"><AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}</p>}
      {s.job && <JobPanel job={s.job} onCancel={() => act(() => sendJson("POST", `/api/sources/${s.id}/cancel`))} />}
    </section>
  );
}

function Steps({ s }: { s: DataSource }) {
  const [open, setOpen] = useState(!s.status.has_data);
  return (
    <div className="mt-4">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
              className="flex items-center gap-1 text-sm font-medium text-sub hover:text-ink">
        How to get your {s.name} data <ChevronDown size={15} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-2 rounded-xl bg-raised/60 p-3 text-sm text-sub">
          <ol className="list-decimal space-y-1 pl-5">
            {s.export_steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
          {s.export_wait && <p className="mt-2 text-xs text-muted">Takes {s.export_wait}.</p>}
        </div>
      )}
    </div>
  );
}

function DropZone({ disabled, progress, onFile }: { disabled: boolean; progress: number | null; onFile: (f: File) => void }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f && !disabled) onFile(f);
      }}
      className={`mt-4 rounded-xl border-2 border-dashed p-5 text-center transition-colors ${over ? "border-ink bg-raised" : "border-line"} ${disabled ? "opacity-60" : ""}`}>
      {progress !== null ? (
        <div>
          <p className="text-sm font-medium">Uploading… {Math.round(progress * 100)}%</p>
          <div className="mx-auto mt-2 h-1.5 max-w-xs overflow-hidden rounded-full bg-raised">
            <div className="h-full rounded-full bg-ink transition-[width]" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
      ) : (
        <>
          <FileUp size={22} className="mx-auto text-sub" />
          <p className="mt-2 text-sm">
            Drop your export here or{" "}
            <button onClick={() => input.current?.click()} disabled={disabled} className="font-semibold underline underline-offset-2 hover:text-ink">
              choose a file
            </button>
          </p>
          <p className="mt-1 text-xs text-muted">The .zip, .json or .csv exactly as you downloaded it</p>
          <input ref={input} type="file" accept=".zip,.json,.csv,.js" className="hidden"
                 onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
        </>
      )}
    </div>
  );
}

function SecretRow({ sec, keychain, onChange }: { sec: DataSource["secrets"][number]; keychain: string; onChange: () => void }) {
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(!sec.set);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setEditing(!sec.set), [sec.set]);

  async function save() {
    setError(null);
    try {
      await sendJson("PUT", `/api/secrets/${sec.name}`, { value });
      setValue("");
      onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }
  return (
    <div className="mt-4 rounded-xl bg-raised/60 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <KeyRound size={15} className="text-sub" />
        <span className="font-medium">{sec.label}</span>
        {sec.set && (
          <span className="flex items-center gap-1 text-xs text-up">
            <Check size={13} /> Saved{sec.where === "environment / .env" ? " (from .env)" : ""}
          </span>
        )}
        {sec.set && !editing && (
          <span className="ml-auto flex gap-3 text-xs">
            <button onClick={() => setEditing(true)} className="text-sub hover:text-ink">Replace</button>
            <button onClick={async () => { await sendJson("DELETE", `/api/secrets/${sec.name}`); onChange(); }}
                    className="text-sub hover:text-down">Remove</button>
          </span>
        )}
      </div>
      {editing && (
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (value.trim()) save(); }}>
          <input type="password" autoComplete="off" spellCheck={false} value={value} onChange={(e) => setValue(e.target.value)}
                 placeholder="Paste it here" aria-label={sec.label}
                 className="min-w-0 flex-1 rounded-lg bg-bg px-3 py-2 text-sm outline-none ring-1 ring-line focus:ring-ink" />
          <Button type="submit" disabled={!value.trim()} primary>Save</Button>
          {sec.set && <Button type="button" onClick={() => setEditing(false)}>Cancel</Button>}
        </form>
      )}
      <p className="mt-2 text-xs text-muted">Kept in {keychain}; it's never shown again or sent anywhere but the platform.</p>
      {error && <p className="mt-1 text-xs text-down">{error}</p>}
    </div>
  );
}

function JobPanel({ job, onCancel }: { job: Job; onCancel: () => void }) {
  const box = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [job.lines.length]);
  const badge = {
    running: <span className="flex items-center gap-1.5 text-ink"><Loader2 size={14} className="animate-spin" /> {STEP_LABEL[job.step]}…</span>,
    done: <span className="flex items-center gap-1.5 text-up"><Check size={14} /> {STEP_LABEL[job.step]}: done</span>,
    failed: <span className="flex items-center gap-1.5 text-down"><AlertTriangle size={14} /> {STEP_LABEL[job.step]}: didn't work</span>,
    cancelled: <span className="flex items-center gap-1.5 text-sub"><X size={14} /> {STEP_LABEL[job.step]}: cancelled</span>,
  }[job.state];
  return (
    <div className="mt-4 rounded-xl bg-bg p-3 ring-1 ring-line">
      <div className="flex items-center justify-between text-sm font-medium">
        {badge}
        {job.state === "running" && (
          <button onClick={onCancel} disabled={job.cancelling} className="text-xs text-sub hover:text-ink disabled:opacity-50">
            {job.cancelling ? "Stopping…" : "Cancel"}
          </button>
        )}
      </div>
      {job.error && <p className="mt-2 whitespace-pre-line text-sm text-down">{job.error}</p>}
      {job.lines.length > 0 && (
        <pre ref={box} className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-sub">
          {job.lines.join("\n")}
        </pre>
      )}
    </div>
  );
}

function DeleteEverything() {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-10 border-t border-line pt-6">
      {!confirm ? (
        <button onClick={() => setConfirm(true)} className="flex items-center gap-1.5 text-sm text-sub hover:text-down">
          <Trash2 size={15} /> Delete everything
        </button>
      ) : (
        <Confirm
          text="Delete the data of every platform? All databases, every export and upload in data/, and every saved key are removed. This can't be undone."
          action="Delete everything"
          onCancel={() => setConfirm(false)}
          onConfirm={async () => {
            try {
              await sendJson("DELETE", "/api/sources");
              setConfirm(false);
            } catch (e) {
              setError(e instanceof ApiError ? e.message : String(e));
            }
            qc.invalidateQueries();
          }}
        />
      )}
      {error && <p className="mt-2 text-sm text-down">{error}</p>}
    </div>
  );
}

function Confirm({ text, action, onConfirm, onCancel }: { text: React.ReactNode; action: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div role="alertdialog" className="mt-4 rounded-xl bg-down/10 p-4 ring-1 ring-down/40">
      <p className="text-sm">{text}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={onConfirm} className="rounded-full bg-down px-4 py-2 text-sm font-bold text-white hover:brightness-110">{action}</button>
        <Button onClick={onCancel}>Keep it</Button>
      </div>
    </div>
  );
}

function Button({ children, primary, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return (
    <button {...rest}
            className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              primary ? "bg-ink text-bg hover:bg-white" : "bg-raised text-ink hover:bg-line"}`}>
      {children}
    </button>
  );
}
