"""Read an Instagram export (Accounts Center → Download your information → JSON) from data/instagram/: the .zip(s)
Instagram sends, or the unzipped folder. Every file goes through the safe importer (size and depth limits).

What's kept, and only this: per action its kind, when, which account (username and display name) or chat, and for
messages whether you sent it and whether it was a shared post/reel; hashtags of posts you liked. Never message text,
captions, comments' text, photos, or anything from the login, device, location or payment files.

Instagram exports double-encode UTF-8 ("Ã©" for "é"); names are repaired. What has real history: likes, comments,
saves, story likes, polls, follows, your posts and stories, and messages. What's only recent: videos watched and
posts viewed (about a week) and stories viewed (about a month) — kept as such, never stretched over time.
"""
from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from ... import db
from ...imports import ImportRejected, Source
from .. import store
from ..base import finish_build
from ..store import Creator, Item, View

SCHEMA = """
CREATE TABLE IF NOT EXISTS ig_events (
    kind     TEXT NOT NULL,     -- like comment save story_like poll follow follower post story message
                                --  watched viewed story_viewed (the last three: recent window only)
    at       INTEGER NOT NULL,  -- epoch seconds
    account  TEXT,              -- the other side: a username, or a chat's id for messages
    name     TEXT,              -- a display name (the account's, or the chat's title)
    mine     INTEGER,           -- messages: 1 = you sent it
    shared   INTEGER,           -- messages: 1 = a shared post or reel
    tags     TEXT               -- likes: the post's hashtags (JSON list)
);
CREATE INDEX IF NOT EXISTS ix_ig_events ON ig_events(kind, at);
"""
OWN_ACTIONS = ("like", "comment", "save", "story_like", "poll", "follow", "post", "story")
RECENT = ("watched", "viewed", "story_viewed")
_USER = re.compile(r"^[A-Za-z0-9._]{1,30}$")


def fix(s) -> str | None:
    """Undo Meta's double-encoded UTF-8."""
    if not isinstance(s, str):
        return None
    try:
        return s.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s


class Export:
    """Every JSON file of the export by its path inside it (zips and loose files), read on demand."""

    def __init__(self, folder: Path):
        self.files: dict[str, tuple[Path, str | None]] = {}
        for p in sorted(folder.rglob("*")) if folder.is_dir() else []:
            if not p.is_file() or ".incoming" in p.parts:
                continue
            if p.suffix.lower() == ".zip":
                with Source(p) as src:
                    for n in src.names():
                        if n.lower().endswith(".json"):
                            self.files[self._key(n)] = (p, n)
            elif p.suffix.lower() == ".json":
                self.files[self._key(p.relative_to(folder).as_posix())] = (p, None)

    @staticmethod
    def _key(path: str) -> str:
        """The part from your_instagram_activity/ (or connections/, ads_information/…) on: the zip's top folder differs."""
        m = re.search(r"(your_instagram_activity|connections|ads_information|logged_information)/.*$", path)
        return m.group(0) if m else path

    def get(self, key: str):
        hit = self.files.get(key)
        if not hit:
            return None
        path, member = hit
        with Source(path) as src:
            return src.read_json(member if member else src.names()[0])

    def under(self, prefix: str) -> list[str]:
        return sorted(k for k in self.files if k.startswith(prefix))


def _items(data) -> list:
    """The list of entries in a file: the file itself, or its one list value."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return next((v for v in data.values() if isinstance(v, list)), [])
    return []


def _owner(entry: dict) -> tuple[str | None, str | None, list[str]]:
    """(username, display name, hashtags) from a label_values entry."""
    user = name = None
    tags: list[str] = []
    for lv in entry.get("label_values") or []:
        if not isinstance(lv, dict) or lv.get("label") is not None:
            continue
        fields = [x for d in lv.get("dict") or [] if isinstance(d, dict) for x in (d.get("dict") or [d]) if isinstance(x, dict)]
        if lv.get("title") == "Owner":
            for x in fields:
                if x.get("label") == "Username" and isinstance(x.get("value"), str) and _USER.match(x["value"]):
                    user = x["value"]
                elif x.get("label") == "Name":
                    name = fix(x.get("value"))
        elif lv.get("title") == "Hashtags":
            tags = [fix(x.get("value")).lstrip("#").lower()[:60] for x in fields if x.get("label") == "Name" and isinstance(x.get("value"), str)]
    return user, name, tags[:20]


def _ts(v) -> int | None:
    return int(v) if isinstance(v, (int, float)) and 1e9 < v < 2e10 else None


def _href_user(href) -> str | None:
    m = re.search(r"instagram\.com/(?:_u/)?([A-Za-z0-9._]{1,30})/?$", str(href or ""))
    return m.group(1) if m else None


def read(folder: Path) -> list[tuple]:
    """Every kept action as (kind, at, account, name, mine, shared, tags)."""
    ex = Export(folder)
    if not ex.files:
        raise FileNotFoundError(f"No Instagram export in {folder}. Add the .zip from Accounts Center (JSON, all time).")
    if not ex.under("your_instagram_activity/") and not ex.under("connections/"):
        raise ImportRejected("that doesn't look like an Instagram export (JSON): no your_instagram_activity/ folder")
    out: list[tuple] = []

    def labelled(key: str, kind: str):
        for e in _items(ex.get(key)):
            if isinstance(e, dict) and _ts(e.get("timestamp")):
                user, name, tags = _owner(e)
                out.append((kind, _ts(e["timestamp"]), user, name, None, None, json.dumps(tags) if tags and kind == "like" else None))

    labelled("your_instagram_activity/likes/liked_posts.json", "like")
    labelled("your_instagram_activity/saved/saved_posts.json", "save")
    labelled("your_instagram_activity/story_interactions/story_likes.json", "story_like")
    labelled("your_instagram_activity/story_interactions/polls.json", "poll")
    labelled("ads_information/ads_and_topics/videos_watched.json", "watched")
    labelled("ads_information/ads_and_topics/posts_viewed.json", "viewed")
    labelled("your_instagram_activity/story_interactions/stories_viewed.json", "story_viewed")
    for k in ex.under("your_instagram_activity/comments/"):
        for e in _items(ex.get(k)):
            m = (e or {}).get("string_map_data") or {}
            at = _ts(((m.get("Time") or {}).get("timestamp")))
            owner = (m.get("Media Owner") or {}).get("value")
            if at:
                out.append(("comment", at, owner if isinstance(owner, str) and _USER.match(owner) else None, None, None, None, None))
    for key, kind in (("connections/followers_and_following/following.json", "follow"),
                      ("connections/followers_and_following/followers_1.json", "follower")):
        for k in [key] + ([x for x in ex.under("connections/followers_and_following/followers_") if x != key] if kind == "follower" else []):
            for e in _items(ex.get(k)):
                for s in (e or {}).get("string_list_data") or []:
                    at = _ts(s.get("timestamp"))
                    user = s.get("value") if isinstance(s.get("value"), str) and _USER.match(s["value"]) else _href_user(s.get("href")) or (
                        e.get("title") if isinstance(e.get("title"), str) and _USER.match(e["title"]) else None)
                    if at:
                        out.append((kind, at, user, None, None, None, None))
    for k in ex.under("your_instagram_activity/media/posts"):
        for e in _items(ex.get(k)):
            at = _ts((e or {}).get("creation_timestamp")) or min((_ts(m.get("creation_timestamp")) for m in (e or {}).get("media") or []
                                                                  if isinstance(m, dict) and _ts(m.get("creation_timestamp"))), default=None)
            if at and "media" in (e or {}):
                out.append(("post", at, None, None, None, None, None))
    for e in _items(ex.get("your_instagram_activity/media/stories.json")):
        if _ts((e or {}).get("creation_timestamp")):
            out.append(("story", _ts(e["creation_timestamp"]), None, None, None, None, None))
    # messages: who you talk with and when; never the text
    threads = [k for k in ex.under("your_instagram_activity/messages/inbox/") if k.endswith(".json")]
    convs: dict[str, dict] = {}
    for k in threads:
        d = ex.get(k) or {}
        cid = k.split("/inbox/")[1].split("/")[0][:120]
        c = convs.setdefault(cid, {"title": fix(d.get("title")), "people": set(), "msgs": []})
        c["people"].update(fix(p.get("name")) for p in d.get("participants") or [] if isinstance(p, dict))
        c["msgs"] += [m for m in d.get("messages") or [] if isinstance(m, dict)]
    if convs:
        from collections import Counter
        count = Counter(p for c in convs.values() for p in c["people"] if p)
        me = count.most_common(1)[0][0] if count else None      # the one person in every conversation
        for cid, c in convs.items():
            others = sorted(p for p in c["people"] if p and p != me)
            title = c["title"] if c["title"] and c["title"] != me else (", ".join(others) or "Just you")
            for m in c["msgs"]:
                at = _ts((m.get("timestamp_ms") or 0) / 1000)
                if at:
                    out.append(("message", at, cid, title[:200], int(fix(m.get("sender_name")) == me), int("share" in m), None))
    return out


def init(conn: sqlite3.Connection) -> None:
    db.init_db(conn)
    conn.executescript(SCHEMA)


def ingest(conn: sqlite3.Connection, folder: Path) -> dict:
    # no de-duplicating of events (two messages in the same second are both real); the same export added twice is
    # read once, because each file is taken once by its path inside the export
    rows = sorted(read(folder), key=lambda r: (r[1], r[0], tuple(str(x) for x in r[2:])))
    init(conn)
    conn.execute("DELETE FROM ig_events")
    conn.executemany("INSERT INTO ig_events VALUES (?,?,?,?,?,?,?)", rows)
    conn.commit()
    by = {}
    for r in rows:
        by[r[0]] = by.get(r[0], 0) + 1
    return {"events": len(rows), **by}


def build(conn: sqlite3.Connection, tz: ZoneInfo) -> int:
    """Your own actions become the shared views (kind = what you did, no time spent: Instagram doesn't say), so
    calendars, years and patterns work; the recent-only watching and others' messages stay in ig_events."""
    init(conn)
    rows = conn.execute("SELECT kind, at, account, name, mine, shared FROM ig_events "
                        f"WHERE kind IN ({','.join('?' * len(OWN_ACTIONS))}) OR (kind = 'message' AND mine = 1) ORDER BY at, kind",
                        OWN_ACTIONS).fetchall()
    views, accounts = [], {}
    for n, (kind, at, account, name, mine, shared) in enumerate(rows, 1):
        local = datetime.fromtimestamp(at, tz)
        creator = f"ig:{account}" if account and kind != "message" else (f"chat:{account}" if account else None)
        if creator:
            accounts.setdefault(creator, name or account)
        views.append(View(n, kind, creator, creator, float(at), local, 0, "exact", session_id=n,
                          bucket="short" if kind == "message" and shared else "long"))
    conn.execute("PRAGMA foreign_keys=OFF")
    count = store.write_views(conn, views)
    # the accounts and chats are both the "items" and the "creators" (like games: the thing is who you engage with)
    who = [(k, (v or k.split(":", 1)[1])[:200], f"https://www.instagram.com/{k[3:]}/" if k.startswith("ig:") else None)
           for k, v in accounts.items()]
    store.write_items(conn, [Item(k, "ok", name, k, url=url) for k, name, url in who])
    store.write_creators(conn, [Creator(k, "ok", name, url=url) for k, name, url in who])
    first = rows[0][1] if rows else None
    db.set_meta(conn, "extra_capabilities", "")
    db.set_meta(conn, "first_action", datetime.fromtimestamp(first, tz).date().isoformat() if first else "")
    finish_build(conn)
    return count
