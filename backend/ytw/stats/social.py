"""Social-family stats (Instagram first), from ig_events: every one a real, dated action. Instagram doesn't say how
long you spent, so nothing here is time; the recent-only watching (about a week of videos, a month of stories) is
reported as exactly that window and never stretched over the years."""
from __future__ import annotations

import json
import sqlite3
from collections import Counter
from datetime import datetime

from .common import Range

T = "ig_events"
OWN = ("like", "comment", "save", "story_like", "poll", "follow", "post", "story")
ACTIVE = ("like", "comment", "save", "story_like", "poll", "post", "story")   # + messages you sent


def _has(conn: sqlite3.Connection) -> bool:
    return bool(conn.execute("SELECT 1 FROM sqlite_master WHERE name = ?", (T,)).fetchone())


def _bounds(r: Range | None) -> tuple[float, float]:
    if r is None:
        return 0, 2e10
    lo = datetime.combine(r.start, datetime.min.time()).timestamp()
    hi = datetime.combine(r.end, datetime.max.time()).timestamp()
    return lo, hi


def _rows(conn, r: Range | None, tz, kinds: tuple[str, ...] | None = None, where: str = "", params: tuple = ()) -> list[sqlite3.Row]:
    """Events in the range (by local day), oldest first."""
    if not _has(conn):
        return []
    q = f"SELECT kind, at, account, name, mine, shared, tags FROM {T} WHERE 1=1"
    p: list = []
    if kinds:
        q += f" AND kind IN ({','.join('?' * len(kinds))})"
        p += list(kinds)
    if where:
        q += f" AND {where}"
        p += list(params)
    rows = conn.execute(q + " ORDER BY at", p).fetchall()
    if r is None:
        return rows
    return [x for x in rows if r.start <= datetime.fromtimestamp(x["at"], tz).date() <= r.end]


def _yours(x) -> bool:
    """An action of yours (what the calendar and clock count): your likes, comments… and messages you sent."""
    return x["kind"] in ACTIVE or (x["kind"] == "message" and x["mine"])


def summary(conn, r: Range | None, tz) -> dict:
    rows = _rows(conn, r, tz, OWN + ("message", "follower"))
    k = Counter(x["kind"] for x in rows)
    sent = sum(1 for x in rows if x["kind"] == "message" and x["mine"])
    days = {datetime.fromtimestamp(x["at"], tz).date() for x in rows if _yours(x)}
    first = _rows(conn, None, tz, ACTIVE)[:1]
    return {
        "likes": k["like"], "comments": k["comment"], "saves": k["save"], "story_likes": k["story_like"], "polls": k["poll"],
        "follows": k["follow"], "followers": k["follower"], "posts": k["post"], "stories": k["story"],
        "messages": k["message"], "messages_sent": sent, "messages_received": k["message"] - sent,
        "shared": sum(1 for x in rows if x["kind"] == "message" and x["mine"] and x["shared"]),
        "chats": len({x["account"] for x in rows if x["kind"] == "message"}),
        "accounts_liked": len({x["account"] for x in rows if x["kind"] == "like" and x["account"]}),
        "active_days": len(days),
        "since": datetime.fromtimestamp(first[0]["at"], tz).date().isoformat() if first else None,
    }


def people(conn, r: Range | None, tz, limit: int = 10) -> dict:
    """Who: the accounts you like most, your top chats (messages both ways, and who sent more), and who you share
    posts and reels with. Each with first and last dates."""
    rows = _rows(conn, r, tz, ("like", "comment", "message"))

    def ranked(xs, key, name=lambda x: x["name"]):
        c: dict[str, dict] = {}
        for x in xs:
            a = key(x)
            if not a:
                continue
            e = c.setdefault(a, {"key": a, "name": name(x) or a, "count": 0, "first": x["at"], "last": x["at"]})
            e["count"] += 1
            e["last"] = x["at"]
        out = sorted(c.values(), key=lambda e: (-e["count"], e["key"]))[:limit]
        for e in out:
            e["first"] = datetime.fromtimestamp(e["first"], tz).date().isoformat()
            e["last"] = datetime.fromtimestamp(e["last"], tz).date().isoformat()
        return out
    msgs = [x for x in rows if x["kind"] == "message"]
    chats = ranked(msgs, lambda x: x["account"])
    mine = Counter(x["account"] for x in msgs if x["mine"])
    for c in chats:
        c["sent"] = mine[c["key"]]
        c["received"] = c["count"] - c["sent"]
    return {
        "liked": ranked([x for x in rows if x["kind"] == "like"], lambda x: x["account"], lambda x: x["account"]),
        "chats": chats,
        "shared_with": ranked([x for x in msgs if x["mine"] and x["shared"]], lambda x: x["account"]),
        "commented": ranked([x for x in rows if x["kind"] == "comment"], lambda x: x["account"], lambda x: x["account"]),
    }


def years(conn, tz) -> list[dict]:
    """Each year: likes, comments, messages (sent/received), shared, follows, posts and stories, active days."""
    by: dict[int, Counter] = {}
    days: dict[int, set] = {}
    for x in _rows(conn, None, tz, OWN + ("message",)):
        d = datetime.fromtimestamp(x["at"], tz)
        c = by.setdefault(d.year, Counter())
        c[x["kind"]] += 1
        if x["kind"] == "message":
            c["sent" if x["mine"] else "received"] += 1
            if x["mine"] and x["shared"]:
                c["shared"] += 1
        if _yours(x):
            days.setdefault(d.year, set()).add(d.date())
    return [{"year": y, "likes": c["like"], "comments": c["comment"], "messages": c["message"], "sent": c["sent"],
             "received": c["received"], "shared": c["shared"], "follows": c["follow"], "posts": c["post"] + c["story"],
             "saves": c["save"], "active_days": len(days.get(y, ()))} for y, c in sorted(by.items())]


def patterns(conn, r: Range | None, tz) -> dict:
    """When you're active (your likes, comments, messages you sent…): by hour, weekday, and each day."""
    hours, weekdays, per_day = [0] * 24, [0] * 7, Counter()
    for x in _rows(conn, r, tz, ACTIVE + ("message",)):
        if not _yours(x):
            continue
        d = datetime.fromtimestamp(x["at"], tz)
        hours[d.hour] += 1
        weekdays[d.weekday()] += 1
        per_day[d.date().isoformat()] += 1
    return {"hours": hours, "weekdays": weekdays, "days": [{"date": k, "count": v} for k, v in sorted(per_day.items())]}


def tags(conn, r: Range | None, tz, limit: int = 15) -> list[dict]:
    """The hashtags on posts you liked: what you're into."""
    c = Counter()
    for x in _rows(conn, r, tz, ("like",)):
        for t in json.loads(x["tags"] or "[]"):
            if t:
                c[t] += 1
    return [{"tag": t, "count": n} for t, n in c.most_common(limit)]


def recent(conn, tz) -> dict:
    """The only watching Instagram exports: videos and posts from about the last week, stories from the last month.
    Exactly that window, with its dates."""
    out = {}
    for kind in ("watched", "viewed", "story_viewed"):
        rows = _rows(conn, None, tz, (kind,))
        acc = Counter(x["account"] for x in rows if x["account"])
        out[kind] = {"count": len(rows),
                     "from": datetime.fromtimestamp(rows[0]["at"], tz).date().isoformat() if rows else None,
                     "to": datetime.fromtimestamp(rows[-1]["at"], tz).date().isoformat() if rows else None,
                     "top": [{"account": a, "count": n} for a, n in acc.most_common(5)]}
    return out


def records(conn, tz) -> dict:
    """Real bests: most likes in a day, the busiest messaging day, the latest night, the longest streak of days you
    were active, your longest-running chat, and when you started."""
    rows = [x for x in _rows(conn, None, tz, ACTIVE + ("message",)) if _yours(x)]
    if not rows:
        return {}
    per_day = Counter((datetime.fromtimestamp(x["at"], tz).date(), x["kind"]) for x in rows)
    likes_day = max(((d, n) for (d, k), n in per_day.items() if k == "like"), key=lambda t: (t[1], t[0]), default=None)
    msg_day = max(((d, n) for (d, k), n in per_day.items() if k == "message"), key=lambda t: (t[1], t[0]), default=None)
    night = [x for x in rows if datetime.fromtimestamp(x["at"], tz).hour < 5]
    late = max(night, key=lambda x: (datetime.fromtimestamp(x["at"], tz).time(), x["at"])) if night else None
    days = sorted({datetime.fromtimestamp(x["at"], tz).date() for x in rows})
    best = run = 1
    start = best_start = best_end = days[0]
    for a, b in zip(days, days[1:]):
        run = run + 1 if (b - a).days == 1 else 1
        start = b if run == 1 else start
        if run > best:
            best, best_start, best_end = run, start, b
    chats = people(conn, None, tz, 50)["chats"]
    span = lambda c: (datetime.fromisoformat(c["last"]) - datetime.fromisoformat(c["first"])).days  # noqa: E731
    longest = max(chats, key=lambda c: (span(c), c["count"]), default=None)
    if longest:
        longest = {**longest, "days": span(longest)}
    return {
        "most_likes_day": {"date": likes_day[0].isoformat(), "count": likes_day[1]} if likes_day else None,
        "most_messages_day": {"date": msg_day[0].isoformat(), "count": msg_day[1]} if msg_day else None,
        "latest_night": {"at": datetime.fromtimestamp(late["at"], tz).isoformat(), "kind": late["kind"]} if late else None,
        "streak": {"days": best, "start": best_start.isoformat(), "end": best_end.isoformat()},
        "longest_chat": longest,
        "first_action": datetime.fromtimestamp(rows[0]["at"], tz).date().isoformat(),
    }
