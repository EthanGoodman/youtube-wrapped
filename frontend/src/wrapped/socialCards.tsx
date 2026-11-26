/* Social Wrapped cards (Instagram), on the shared card kit: the year in likes, messages and the posts and reels you
   shared, your people, what you liked (hashtags), your hour, a personality and a summary. Every number is a real,
   dated action; nothing is time spent (Instagram doesn't say). */
import { motion } from "framer-motion";
import { compact, num } from "../format";
import { OV } from "../overview/kit";
import { hourLabel, yearSpan } from "../overview/takeaways";
import { CardDef, CountUp, Personality, PersonalityStrip, SmallLabel } from "./cards";
import { Big, Kicker, StatBox, Sticker, WCard, Wordmark, fit, pop, rise } from "./kit";
import { SocialWrappedData } from "./types";

const tag = (d: SocialWrappedData) => String(d.year);
const n = (v: number, one: string, many = `${one}s`) => `${num(v)} ${v === 1 ? one : many}`;

function Bubble({ name, size }: { name: string; size: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full border-[3px] font-ov-display font-extrabold"
          style={{ width: size, height: size, borderColor: OV.ink, background: OV.paper, color: OV.ink, fontSize: size * 0.42 }}>
      {(name.replace(/^[^A-Za-z0-9]+/, "")[0] ?? "?").toUpperCase()}
    </span>
  );
}

type SCard = CardDef<SocialWrappedData>;

export const SOCIAL_CARDS: SCard[] = [
  {
    id: "intro", label: "Intro",
    render: (d) => (
      <WCard tone="ink" footer={false} ring="bl">
        <div className="flex flex-1 flex-col justify-center">
          <motion.div {...pop(0.1)}><Wordmark size={22} /></motion.div>
          <Big size={116} delay={0.4} hi className="mt-5 whitespace-nowrap">{d.year}</Big>
          <motion.p {...rise(0.7)} className="mt-4 font-ov-display text-[28px] font-extrabold leading-tight">Your year on Instagram.</motion.p>
          <motion.p {...rise(1.1)} className="mt-12 font-shelf-mono text-[13px]" style={{ color: OV.mute }}>Tap to start ›</motion.p>
        </div>
      </WCard>
    ),
  },
  {
    id: "likes", label: "Likes",
    when: (d) => d.summary.likes > 0,
    render: (d) => (
      <WCard tone="cream" tag={tag(d)}>
        <Kicker>In {d.year} you liked</Kicker>
        <Big size={120} delay={0.3} hi><CountUp to={d.summary.likes} /></Big>
        <Big size={36} delay={0.4}>{d.summary.likes === 1 ? "post" : "posts"}</Big>
        <motion.div {...rise(1.1)} className="mt-8 flex flex-col gap-2.5 text-[17px]">
          <p>From <b>{n(d.summary.accounts_liked, "account")}</b>.</p>
          {d.summary.comments > 0 && <p>And left <b>{n(d.summary.comments, "comment")}</b>.</p>}
          <p>You were active on <b>{n(d.active_days, "day")}</b>.</p>
        </motion.div>
      </WCard>
    ),
  },
  {
    id: "top-chat", label: "Your #1 chat",
    when: (d) => d.people.chats.length > 0,
    render: (d) => {
      const c = d.people.chats[0];
      const share = d.summary.messages ? Math.round((c.count / d.summary.messages) * 100) : 0;
      return (
        <WCard tone="mustard" tag={tag(d)}>
          <Kicker>Your #1 chat of {d.year}</Kicker>
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <motion.div {...pop(0.6)} className="relative"><Bubble name={c.name} size={150} /><Sticker size={60} delay={1.2}>#1</Sticker></motion.div>
            <Big size={fit(c.name, 40)} delay={1.2} className="mt-5">{c.name}</Big>
            <motion.p {...rise(1.5)} className="mt-2 font-shelf-mono text-[14px]">{n(c.count, "message")} · {share}% of all your messages</motion.p>
            <motion.p {...rise(1.8)} className="mt-1 font-shelf-mono text-[13px]">{num(c.sent ?? 0)} from you, {num(c.received ?? 0)} from them</motion.p>
          </div>
        </WCard>
      );
    },
  },
  {
    id: "chats", label: "Top chats",
    when: (d) => d.people.chats.length > 1,
    render: (d) => (
      <WCard tone="paper" tag={tag(d)}>
        <Big size={40} delay={0}>Who you talked to most</Big>
        <ol className="mt-5 flex flex-col gap-3">
          {d.people.chats.slice(0, 5).map((c, i) => (
            <motion.li key={c.key} {...rise(0.3 + i * 0.16)} className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[3px] font-ov-display text-[16px] font-extrabold"
                    style={{ background: i === 0 ? OV.mustard : OV.paper, borderColor: OV.ink }}>{i + 1}</span>
              <div className="min-w-0">
                <div className="truncate text-[18px] font-bold">{c.name}</div>
                <div className="font-shelf-mono text-[12px]" style={{ color: OV.soft }}>{n(c.count, "message")}</div>
              </div>
            </motion.li>
          ))}
        </ol>
      </WCard>
    ),
  },
  {
    id: "shared", label: "Shared",
    when: (d) => d.summary.shared > 0,
    render: (d) => {
      const top = d.people.shared_with[0];
      return (
        <WCard tone="teal" tag={tag(d)}>
          <Kicker>You sent your friends</Kicker>
          <Big size={130} delay={0.3} hi><CountUp to={d.summary.shared} /></Big>
          <Big size={34} delay={0.5}>posts &amp; reels</Big>
          {top && (
            <motion.p {...rise(1.2)} className="mt-auto text-[18px]">
              Mostly to <b>{top.name}</b>: {n(top.count, "share")}. Saw it, thought of them.
            </motion.p>
          )}
        </WCard>
      );
    },
  },
  {
    id: "accounts", label: "Accounts you liked",
    when: (d) => d.people.liked.length > 0,
    render: (d) => (
      <WCard tone="ink" tag={tag(d)}>
        <Kicker>The accounts you liked most</Kicker>
        <ol className="mt-5 flex flex-col gap-3">
          {d.people.liked.slice(0, 5).map((c, i) => (
            <motion.li key={c.key} {...rise(0.3 + i * 0.16)} className="flex items-baseline justify-between gap-3">
              <span className="truncate font-ov-display text-[22px] font-extrabold" style={{ color: i === 0 ? OV.mustard : OV.paper }}>@{c.key}</span>
              <span className="shrink-0 font-shelf-mono text-[13px]" style={{ color: OV.mute }}>{n(c.count, "like")}</span>
            </motion.li>
          ))}
        </ol>
        {d.tags.length > 0 && (
          <motion.p {...rise(1.4)} className="mt-auto text-[15px]" style={{ color: OV.mute }}>
            Your hashtags: {d.tags.slice(0, 4).map((t) => `#${t.tag}`).join(" · ")}
          </motion.p>
        )}
      </WCard>
    ),
  },
  {
    id: "clock", label: "Your hour",
    when: (d) => d.busiest_hour != null,
    render: (d) => (
      <WCard tone="ink" tag={tag(d)}>
        <Kicker>You're most active at</Kicker>
        <Big size={110} delay={0.3} hi className="whitespace-nowrap">{hourLabel(d.busiest_hour!)}</Big>
        <div className="mt-8 flex h-[110px] items-end gap-[3px]" aria-hidden>
          {d.hours.map((v, h) => (
            <motion.span key={h} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: 0.8 + h * 0.03 }}
                         className="flex-1 origin-bottom rounded-t-sm"
                         style={{ height: `${(v / Math.max(1, ...d.hours)) * 100}%`, minHeight: 2, background: h === d.busiest_hour ? OV.mustard : "#5E554A" }} />
          ))}
        </div>
        <div className="mt-1 flex justify-between font-shelf-mono text-[11px]" style={{ color: OV.mute }}><span>12 AM</span><span>12 PM</span><span>11 PM</span></div>
      </WCard>
    ),
  },
  {
    id: "follows", label: "New follows",
    when: (d) => d.summary.follows > 0 || d.summary.posts + d.summary.stories > 0,
    render: (d) => (
      <WCard tone="cream" tag={tag(d)}>
        <Kicker>Also in {d.year}</Kicker>
        <div className="mt-6 flex flex-col gap-6">
          {d.summary.follows > 0 && <div><Big size={90} delay={0.3} hi><CountUp to={d.summary.follows} /></Big><Big size={28} delay={0.4}>new accounts followed</Big></div>}
          {d.summary.posts + d.summary.stories > 0 && <div><Big size={90} delay={0.7}><CountUp to={d.summary.posts + d.summary.stories} /></Big><Big size={28} delay={0.8}>posts &amp; stories of your own</Big></div>}
        </div>
      </WCard>
    ),
  },
  { id: "personality", label: "Personality", render: (d) => <Personality d={d} tagText={tag(d)} /> },
  { id: "summary", label: "Summary", render: (d) => <SocialSummary d={d} /> },
];

function SocialSummary({ d }: { d: SocialWrappedData }) {
  const top = d.people.chats[0];
  return (
    <WCard tone="cream" footer={false} ring="none">
      <div className="-mt-4 flex items-start justify-between">
        <Wordmark size={17} />
        <span className="font-ov-display text-[36px] font-extrabold leading-none" style={{ color: OV.accent }}>{d.year}</span>
      </div>
      <div className="mt-5"><SmallLabel>Your #1 chat</SmallLabel></div>
      <p className="mt-1 truncate font-ov-display text-[26px] font-extrabold">{top ? top.name : "–"}</p>
      {top && <p className="font-shelf-mono text-[11px]" style={{ color: OV.soft }}>{n(top.count, "message")} · {yearSpan(top.first, top.last)}</p>}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <StatBox label="Likes" value={compact(d.summary.likes)} sub={`${n(d.summary.accounts_liked, "account")}`} />
        <StatBox label="Messages" value={compact(d.summary.messages)} sub={`${compact(d.summary.messages_sent)} from you`} />
        <StatBox label="Shared" value={num(d.summary.shared)} sub="posts & reels" />
        <StatBox label="Your hour" value={d.busiest_hour != null ? hourLabel(d.busiest_hour) : "–"} sub={d.tags[0] ? `#${d.tags[0].tag}` : undefined} />
      </div>
      <PersonalityStrip p={d.personality} />
    </WCard>
  );
}
