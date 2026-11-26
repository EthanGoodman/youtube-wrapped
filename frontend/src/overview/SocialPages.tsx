/* The social family's pages (Instagram first): Overview, People and Activity. Instagram doesn't say how long you
   spent, so these are about who and when: likes, messages, posts and reels you shared, follows, your own posts, all of
   them real and dated. The only watching it exports (about a week of videos, a month of stories) is shown as that. */
import { ReactNode, useState } from "react";
import { Link } from "../platform";
import { useMeta, useStats } from "../api";
import { useFilters, useLinkQuery } from "../filters";
import { compact, date, num } from "../format";
import { Band, OV, PageBody, PageHeader, ScrollRow, Seg, Skeleton, StatsFrame, kicker, useAccent } from "./kit";
import { HeatLegend, HoverBars, Readout, Ticks } from "./charts";
import { DAYS, calendarWeeks, heatColor, heatLevel, heatRange, hourLabel, periodTitle, yearSpan } from "./takeaways";

interface Summary {
  likes: number; comments: number; saves: number; story_likes: number; polls: number; follows: number; followers: number;
  posts: number; stories: number; messages: number; messages_sent: number; messages_received: number; shared: number;
  chats: number; accounts_liked: number; active_days: number; since: string | null;
}
interface Person { key: string; name: string; count: number; first: string; last: string; sent?: number; received?: number }
interface People { liked: Person[]; chats: Person[]; shared_with: Person[]; commented: Person[] }
interface Year { year: number; likes: number; comments: number; messages: number; sent: number; received: number; shared: number;
  follows: number; posts: number; saves: number; active_days: number }
interface Patterns { hours: number[]; weekdays: number[]; days: { date: string; count: number }[] }
interface Recent { [k: string]: { count: number; from: string | null; to: string | null; top: { account: string; count: number }[] } }
interface Records {
  most_likes_day?: { date: string; count: number } | null; most_messages_day?: { date: string; count: number } | null;
  latest_night?: { at: string; kind: string } | null; streak?: { days: number; start: string; end: string };
  longest_chat?: Person & { days: number } | null; first_action?: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const igLink = (user: string) => `https://www.instagram.com/${encodeURIComponent(user)}/`;
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

function Card({ label, title, children, className = "", dark = false }: { label: string; title?: ReactNode; children: ReactNode; className?: string; dark?: boolean }) {
  return (
    <section className={`flex min-w-0 flex-col gap-3 rounded-2xl border-2 p-5 ${className}`}
             style={{ background: dark ? OV.ink : OV.paper, color: dark ? OV.paper : OV.ink, borderColor: OV.ink }}>
      <span className={kicker} style={{ color: dark ? OV.mute : OV.soft }}>{label}</span>
      {title && <h3 className="font-ov-display text-[clamp(20px,2vw,26px)] font-extrabold leading-tight">{title}</h3>}
      {children}
    </section>
  );
}

function Initial({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <span aria-hidden className="flex shrink-0 items-center justify-center rounded-full border-2 font-ov-display font-extrabold"
          style={{ width: size, height: size, borderColor: OV.ink, background: OV.sand, fontSize: size * 0.42 }}>
      {(name.replace(/^[^A-Za-z0-9]+/, "")[0] ?? "?").toUpperCase()}
    </span>
  );
}

// ------------------------------------------------------------------ Overview

export function SocialOverviewPage() {
  const meta = useMeta().data;
  const { filters } = useFilters();
  const s = useStats<Summary>("social/summary");
  const p = useStats<People>("social/people", { limit: 6 });
  const title = periodTitle(filters, meta?.today);
  return (
    <StatsFrame>
      <Hero s={s.data} p={p.data} title={title} />
      <main className="mx-auto flex max-w-[1400px] flex-col gap-12 px-4 pb-16 pt-10 sm:px-8">
        {filters.range === "all" && <YearsBand />}
        <PeopleBand p={p.data} />
        <div className="grid grid-cols-[minmax(0,1fr)] gap-12 xl:grid-cols-2">
          <TagsBand />
          <RecentBand />
        </div>
        <WhenBand />
        <RecordsBand />
      </main>
    </StatsFrame>
  );
}

function Hero({ s, p, title }: { s?: Summary; p?: People; title: string }) {
  const meta = useMeta().data;
  const accent = useAccent();
  const top = p?.chats[0];
  return (
    <section className="relative overflow-hidden" style={{ background: OV.ink, color: OV.paper }}>
      <div aria-hidden className="absolute inset-0" style={{ background: `linear-gradient(120deg, ${OV.ink} 35%, ${accent} 150%)` }} />
      <div className="relative mx-auto flex min-h-[clamp(380px,54vh,560px)] max-w-[1400px] flex-col justify-center gap-8 px-4 py-10 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex max-w-[680px] flex-col gap-5">
          <span className={kicker} style={{ color: OV.mustard }}>Your {meta?.platform.name ?? "Instagram"} · {title}</span>
          {s ? (
            <>
              <h1 className="flex items-baseline gap-4 font-ov-display font-extrabold leading-[0.82]">
                <span className="text-[clamp(88px,12vw,180px)] tracking-[-0.05em]" style={{ color: OV.mustard }}>{num(s.likes)}</span>
                <span className="flex flex-col gap-1">
                  <span className="text-[clamp(26px,2.6vw,38px)]">{s.likes === 1 ? "like" : "likes"}</span>
                  {s.since && title === "Lifetime" && <span className="font-shelf-mono text-[12px] font-normal" style={{ color: OV.mute }}>since {date(s.since)}</span>}
                </span>
              </h1>
              <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
                <Stat v={compact(s.messages)} l={`messages · ${compact(s.messages_sent)} yours`} />
                <Stat v={num(s.shared)} l="posts & reels you shared" />
                <Stat v={num(s.chats)} l="chats" />
                <Stat v={num(s.active_days)} l="days you were active" />
              </dl>
            </>
          ) : <Skeleton h={220} dark />}
        </div>
        {top && (
          <div className="flex shrink-0 flex-col gap-2 lg:w-[300px]">
            <span className={kicker} style={{ color: OV.mustard }}>Your #1 chat</span>
            <span className="font-ov-display text-[clamp(26px,2.6vw,36px)] font-extrabold leading-tight">{top.name}</span>
            <span className="font-shelf-mono text-[13px]" style={{ color: OV.mute }}>{plural(top.count, "message")} · {yearSpan(top.first, top.last)}</span>
            <SentBar sent={top.sent ?? 0} received={top.received ?? 0} dark />
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ v, l }: { v: string; l: string }) {
  return (
    <div className="flex flex-col">
      <dt className="order-2 font-shelf-mono text-[12px]" style={{ color: OV.mute }}>{l}</dt>
      <dd className="order-1 font-ov-display text-[30px] font-extrabold leading-tight">{v}</dd>
    </div>
  );
}

/** Who sent more in a chat: you (mustard) and them. */
function SentBar({ sent, received, dark = false }: { sent: number; received: number; dark?: boolean }) {
  const total = Math.max(1, sent + received);
  return (
    <span className="flex w-full flex-col gap-1">
      <span className="flex h-2 w-full overflow-hidden rounded-full" style={{ background: dark ? "#4A433B" : OV.sand }} aria-hidden>
        <span style={{ width: `${(sent / total) * 100}%`, background: OV.mustard }} />
      </span>
      <span className="font-shelf-mono text-[11px]" style={{ color: dark ? OV.mute : OV.soft }}>you {Math.round((sent / total) * 100)}% · them {Math.round((received / total) * 100)}%</span>
    </span>
  );
}

function YearsBand() {
  const y = useStats<Year[]>("social/years");
  const [m, setM] = useState<"likes" | "messages" | "shared">("likes");
  const rows = y.data ?? [];
  const best = rows.length ? rows.reduce((a, b) => (b[m] > a[m] ? b : a)) : null;
  const word = { likes: "likes", messages: "messages", shared: "posts & reels shared" }[m];
  return (
    <Band label="Your years" title={best && best[m] ? `${best.year} was your biggest year for ${word}: ${num(best[m])}.` : "Your years"}>
      {!y.data ? <Skeleton h={220} /> : (
        <Card label={`${word} each year`}>
          <Seg label="Show" value={m} onChange={setM} options={[["likes", "Likes"], ["messages", "Messages"], ["shared", "Shared"]]} />
          <HoverBars height={170} gap={10} radius={6} hint="Hover a year to see it." ariaLabel={`${word} each year`}
                     bars={rows.map((r) => ({ key: String(r.year), label: String(r.year), value: r[m],
                                              display: `${num(r[m])} ${word}${m === "messages" ? ` · ${num(r.sent)} yours` : ""}`,
                                              color: r === best ? OV.mustard : OV.ink }))}
                     ticks={<Ticks labels={rows.map((r) => String(r.year))} />} />
        </Card>
      )}
    </Band>
  );
}

function PersonRow({ p, rank, max, href, line }: { p: Person; rank: number; max: number; href?: string; line: ReactNode }) {
  const body = (
    <span className="flex items-center gap-3 border-b py-2.5" style={{ borderColor: "#E0D5C1" }}>
      <span className="w-6 shrink-0 text-right font-ov-display text-[16px] font-extrabold">{rank}</span>
      <Initial name={p.name} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-[15px] font-bold">{p.name}</span>
        <span className="block h-2 w-[60%] overflow-hidden rounded-full" style={{ background: OV.sand }}>
          <span className="block h-full rounded-full" style={{ width: `${Math.max(3, (p.count / max) * 100)}%`, background: rank === 1 ? OV.mustard : OV.ink }} />
        </span>
        <span className="truncate font-shelf-mono text-[11px]" style={{ color: OV.soft }}>{line}</span>
      </span>
      <span className="shrink-0 font-ov-display text-[16px] font-extrabold">{compact(p.count)}</span>
    </span>
  );
  return <li>{href ? <a href={href} target="_blank" rel="noreferrer noopener" className="block hover:bg-black/[0.03]">{body}</a> : body}</li>;
}

function PeopleBand({ p }: { p?: People }) {
  return (
    <Band label="Your people" title={p?.chats[0] ? `You and ${p.chats[0].name}: ${plural(p.chats[0].count, "message")}.` : "Your people"} link={["/people", "All your people"]}>
      {!p ? <Skeleton h={300} /> : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
          <Card label="Top chats">
            {!p.chats.length ? <p style={{ color: OV.soft }}>No messages in this period.</p> : (
              <ol className="flex flex-col">
                {p.chats.map((c, i) => <PersonRow key={c.key} p={c} rank={i + 1} max={p.chats[0].count}
                                                  line={<>{num(c.sent ?? 0)} from you · {yearSpan(c.first, c.last)}</>} />)}
              </ol>
            )}
          </Card>
          <Card label="Accounts you like most">
            {!p.liked.length ? <p style={{ color: OV.soft }}>No likes in this period.</p> : (
              <ol className="flex flex-col">
                {p.liked.map((c, i) => <PersonRow key={c.key} p={c} rank={i + 1} max={p.liked[0].count} href={igLink(c.key)}
                                                  line={<>@{c.key} · {yearSpan(c.first, c.last)}</>} />)}
              </ol>
            )}
          </Card>
        </div>
      )}
    </Band>
  );
}

function TagsBand() {
  const t = useStats<{ tag: string; count: number }[]>("social/tags", { limit: 14 });
  const max = Math.max(1, ...(t.data ?? []).map((x) => x.count));
  return (
    <Band label="What you like" title={t.data?.[0] ? `Mostly #${t.data[0].tag}.` : "What you like"}>
      {!t.data ? <Skeleton h={200} /> : !t.data.length ? <p style={{ color: OV.soft }}>No hashtags in this period.</p> : (
        <div className="flex flex-wrap gap-2">
          {t.data.map((x, i) => (
            <span key={x.tag} className="rounded-full border-2 px-3 py-1.5 font-bold"
                  style={{ borderColor: OV.ink, background: i === 0 ? OV.mustard : OV.paper, fontSize: 13 + Math.round((x.count / max) * 9) }}>
              #{x.tag} <span className="font-shelf-mono text-[11px] font-normal">{num(x.count)}</span>
            </span>
          ))}
        </div>
      )}
    </Band>
  );
}

function RecentBand() {
  const r = useStats<Recent>("social/recent");
  const w = r.data?.watched;
  const st = r.data?.story_viewed;
  return (
    <Band label={w?.from ? `This past week · ${yearSpan(w.from, w.to!)}` : "This past week"}
          title={w?.count ? `${plural(w.count, "video")} watched.` : "This past week"}>
      {!r.data ? <Skeleton h={200} /> : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <Card label="Videos watched · most from" dark>
            <ol className="flex flex-col gap-1.5">
              {(w?.top ?? []).map((a) => (
                <li key={a.account} className="flex justify-between gap-3 text-[14px]">
                  <a href={igLink(a.account)} target="_blank" rel="noreferrer noopener" className="truncate hover:underline">@{a.account}</a>
                  <span className="font-shelf-mono">{num(a.count)}</span>
                </li>
              ))}
            </ol>
            {r.data.viewed?.count ? <p className="font-shelf-mono text-[12px]" style={{ color: OV.mute }}>and {plural(r.data.viewed.count, "post")} viewed</p> : null}
          </Card>
          <Card label={st?.from ? `Stories · ${yearSpan(st.from, st.to!)}` : "Stories"} title={st ? `${compact(st.count)} viewed` : undefined}>
            <ol className="flex flex-col gap-1.5">
              {(st?.top ?? []).map((a) => (
                <li key={a.account} className="flex justify-between gap-3 text-[14px]">
                  <a href={igLink(a.account)} target="_blank" rel="noreferrer noopener" className="truncate hover:underline">@{a.account}</a>
                  <span className="font-shelf-mono">{num(a.count)}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      )}
    </Band>
  );
}

function WhenBand() {
  const pt = useStats<Patterns>("social/patterns");
  const h = pt.data?.hours ?? [];
  const total = h.reduce((a, b) => a + b, 0);
  const peak = h.length ? h.indexOf(Math.max(...h)) : 0;
  const wd = pt.data?.weekdays ?? [];
  const busiest = wd.length && Math.max(...wd) ? WEEKDAYS[wd.indexOf(Math.max(...wd))] : null;
  const night = total ? Math.round((h.slice(0, 5).reduce((a, b) => a + b, 0) / total) * 100) : 0;
  return (
    <Band label="When you're active" title={total ? `Mostly around ${hourLabel(peak)}${night >= 10 ? `, and ${night}% after midnight` : ""}.` : "When you're active"}>
      {!pt.data ? <Skeleton h={220} /> : !total ? <p style={{ color: OV.soft }}>Nothing in this period.</p> : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[2fr_1fr]">
          <Card label="By hour of the day" dark>
            <HoverBars dark height={150} hint={`${hourLabel(peak)} is your busiest hour. Hover one to see it.`} ariaLabel={`Your activity by hour. Busiest: ${hourLabel(peak)}.`}
                       bars={h.map((v, i) => ({ key: String(i), label: `${hourLabel(i)} to ${hourLabel((i + 1) % 24)}`, value: v, display: num(v), color: i === peak ? OV.mustard : "#5E554A" }))}
                       ticks={<Ticks dark labels={["12 AM", "6 AM", "12 PM", "6 PM"]} />} />
          </Card>
          <Card label="By day of the week" title={busiest ? `${busiest}s` : undefined}>
            <HoverBars height={120} gap={8} radius={6} hint="Hover a day to see it." ariaLabel={`Your activity by weekday. Busiest: ${busiest}.`}
                       bars={wd.map((v, i) => ({ key: DAYS[i], label: WEEKDAYS[i], value: v, display: num(v), color: v === Math.max(...wd) ? OV.teal : "#D9CDB6" }))}
                       ticks={<Ticks labels={DAYS} />} />
          </Card>
        </div>
      )}
    </Band>
  );
}

function RecordsBand() {
  const r = useStats<Records>("social/records");
  const d = r.data;
  const cards: ReactNode[] = [];
  if (d?.most_likes_day) cards.push(<Rec key="l" label="Most likes in a day" bg={OV.mustard} big={plural(d.most_likes_day.count, "like")} line={date(d.most_likes_day.date)} />);
  if (d?.latest_night) cards.push(<Rec key="n" label="Latest night" bg={OV.ink} fg={OV.paper} big={clock(d.latest_night.at)}
                                       line={`${d.latest_night.kind === "message" ? "a message" : `a ${d.latest_night.kind}`}, ${date(d.latest_night.at)}`} />);
  if (d?.most_messages_day) cards.push(<Rec key="m" label="Most messages in a day" bg={OV.paper} big={plural(d.most_messages_day.count, "message")} line={`from you, ${date(d.most_messages_day.date)}`} />);
  if (d?.streak && d.streak.days > 1) cards.push(<Rec key="s" label="Longest streak" bg={OV.teal} fg={OV.paper} big={`${num(d.streak.days)} days in a row`} line={yearSpan(d.streak.start, d.streak.end)} />);
  if (d?.longest_chat) cards.push(<Rec key="c" label="Longest-running chat" bg={OV.paper} big={d.longest_chat.name} line={`${yearSpan(d.longest_chat.first, d.longest_chat.last)}, ${plural(d.longest_chat.count, "message")}`} />);
  return (
    <Band label="Records" title="Your personal bests.">
      {!d ? <Skeleton h={160} /> : <div className="grid gap-4 md:grid-cols-3">{cards.slice(0, 6)}</div>}
    </Band>
  );
}

function Rec({ label, big, line, bg, fg = OV.ink }: { label: string; big: string; line: string; bg: string; fg?: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border-2 p-5" style={{ background: bg, color: fg, borderColor: OV.ink }}>
      <span className={kicker}>{label}</span>
      <span className="font-ov-display text-[clamp(22px,2.2vw,30px)] font-extrabold leading-tight">{big}</span>
      <span className="text-[14px]">{line}</span>
    </div>
  );
}

// ------------------------------------------------------------------ People

export function SocialPeoplePage() {
  const meta = useMeta().data;
  const { filters } = useFilters();
  const p = useStats<People>("social/people", { limit: 30 });
  const [tab, setTab] = useState<"chats" | "shared" | "liked" | "commented">("chats");
  const list = p.data ? { chats: p.data.chats, shared: p.data.shared_with, liked: p.data.liked, commented: p.data.commented }[tab] : [];
  const title = periodTitle(filters, meta?.today);
  const label = { chats: "messages both ways", shared: "posts & reels you sent them", liked: "posts of theirs you liked", commented: "comments you left" }[tab];
  return (
    <StatsFrame>
      <PageHeader label={`People · ${title}`} title={p.data?.chats[0] ? `${p.data.chats[0].name} is your #1 chat.` : "Your people"}>
        <Seg label="Show" value={tab} onChange={setTab} dark
             options={[["chats", "Chats"], ["shared", "Shared with"], ["liked", "Liked most"], ["commented", "Commented on"]]} />
      </PageHeader>
      <PageBody>
        {!p.data ? <Skeleton h={500} /> : !list.length ? <p style={{ color: OV.soft }}>Nothing in this period.</p> : (
          <Card label={label}>
            <ol className="flex flex-col">
              {list.map((c, i) => (
                <PersonRow key={c.key} p={c} rank={i + 1} max={list[0].count} href={tab === "liked" || tab === "commented" ? igLink(c.key) : undefined}
                           line={<>{tab === "chats" ? `${num(c.sent ?? 0)} from you · ${num(c.received ?? 0)} from them · ` : tab === "liked" || tab === "commented" ? `@${c.key} · ` : ""}
                                   {yearSpan(c.first, c.last)}</>} />
              ))}
            </ol>
          </Card>
        )}
      </PageBody>
    </StatsFrame>
  );
}

// ------------------------------------------------------------------ Activity

export function SocialActivityPage() {
  const meta = useMeta().data;
  const { filters } = useFilters();
  const pt = useStats<Patterns>("social/patterns");
  const y = useStats<Year[]>("social/years");
  const title = periodTitle(filters, meta?.today);
  const days = pt.data?.days ?? [];
  return (
    <StatsFrame>
      <PageHeader label={`Activity · ${title}`} title={pt.data ? `Active on ${plural(days.length, "day")}.` : "Your activity"} />
      <PageBody>
        {!pt.data ? <Skeleton h={400} /> : <Calendar days={days} />}
        {y.data && <YearTable rows={y.data} />}
      </PageBody>
    </StatsFrame>
  );
}

function Calendar({ days }: { days: { date: string; count: number }[] }) {
  const [day, setDay] = useState<{ date: string; count: number } | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const count: Record<string, number> = Object.fromEntries(days.map((d) => [d.date, d.count]));
  const max = Math.max(1, ...days.map((d) => d.count));
  const years = [...new Set(days.map((d) => d.date.slice(0, 4)))].sort().reverse();
  const nice = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const info = day ? `${nice(day.date)} · ${day.count ? plural(day.count, "action") : "nothing"}`
    : level != null ? (level === 0 ? "Quiet days" : `Days with ${heatRange(level, max)[0]}–${heatRange(level, max)[1]} actions`)
    : "Hover a day to see it, or a shade to light up those days.";
  if (!days.length) return <p style={{ color: OV.soft }}>Nothing in this period.</p>;
  return (
    <Card label="Every day">
      <Readout text={info} active={!!day || level != null} />
      <div className="flex flex-col gap-5" onMouseLeave={() => setDay(null)}>
        {years.map((yy) => {
          const cells: { date: string; count: number }[] = [];
          const last = `${yy}-12-31` < new Date().toISOString().slice(0, 10) ? `${yy}-12-31` : new Date().toISOString().slice(0, 10);
          for (let t = new Date(`${yy}-01-01T00:00:00`); t <= new Date(last + "T00:00:00"); t.setDate(t.getDate() + 1)) {
            const iso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
            cells.push({ date: iso, count: count[iso] ?? 0 });
          }
          const weeks = calendarWeeks(cells);
          return (
            <div key={yy} className="flex flex-col gap-1.5">
              <span className="font-shelf-mono text-[12px]" style={{ color: OV.soft }}><strong className="font-ov-display text-[16px]" style={{ color: OV.ink }}>{yy}</strong> · {plural(cells.filter((c) => c.count).length, "day")}</span>
              <ScrollRow bg={OV.paper} className="pb-1">
                <div className="grid gap-[3px]" role="img" aria-label={`${yy}: active on ${cells.filter((c) => c.count).length} days`}
                     style={{ gridTemplateColumns: `24px repeat(${weeks.length},minmax(0,1fr))`, width: `min(100%, ${weeks.length * 22 + 28}px)`, minWidth: `${weeks.length * 11 + 28}px` }}>
                  {[0, 1, 2, 3, 4, 5, 6].map((r) => [
                    <span key={`d${r}`} className="self-center font-shelf-mono text-[9px]" style={{ color: OV.soft }}>{r % 2 === 0 ? DAYS[r] : ""}</span>,
                    ...weeks.map((w, i) => {
                      const d = w[r];
                      if (!d) return <span key={`${i}-${r}`} />;
                      const lv = heatLevel(d.count, max);
                      return <span key={`${i}-${r}`} onMouseEnter={() => setDay(d)} className="aspect-square rounded-[2px]"
                                   style={{ background: heatColor(d.count, max), opacity: level != null && lv !== level ? 0.18 : 1,
                                            boxShadow: day?.date === d.date ? `0 0 0 2px ${OV.ink}` : undefined }} />;
                    }),
                  ])}
                </div>
              </ScrollRow>
            </div>
          );
        })}
      </div>
      <HeatLegend level={level} setLevel={setLevel} />
    </Card>
  );
}

function YearTable({ rows }: { rows: Year[] }) {
  const q = useLinkQuery();
  const cols: [keyof Year, string][] = [["likes", "Likes"], ["sent", "Messages sent"], ["received", "Received"], ["shared", "Shared"],
    ["comments", "Comments"], ["follows", "New follows"], ["posts", "Posts & stories"], ["active_days", "Active days"]];
  return (
    <Band label="Each year" title="Your years, side by side">
      <ScrollRow bg={OV.bg} className="pb-1">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead>
            <tr className="font-shelf-mono text-[11px] uppercase" style={{ color: OV.soft }}>
              <th className="py-2 pr-3">Year</th>{cols.map(([, l]) => <th key={l} className="py-2 pr-3 text-right">{l}</th>)}
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((r) => (
              <tr key={r.year} className="border-t" style={{ borderColor: "#E0D5C1" }}>
                <td className="py-2.5 pr-3"><Link to={`/wrapped?year=${r.year}${q ? `&${q.slice(1)}` : ""}`} className="font-ov-display text-[18px] font-extrabold hover:underline">{r.year}</Link></td>
                {cols.map(([k]) => <td key={k} className="py-2.5 pr-3 text-right font-ov-display text-[16px] font-extrabold">{num(r[k] as number)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRow>
    </Band>
  );
}
