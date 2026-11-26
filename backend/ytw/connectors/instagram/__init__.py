"""Instagram: your activity from the export Instagram gives you (likes, comments, saves, follows, your posts and
stories, and who you message), all of it dated. The first platform of the social family."""
from __future__ import annotations

from ...imports import ImportRejected
from ..base import Connector, ConnectorError, Manifest, vocab

MANIFEST = Manifest(
    "instagram", "Instagram", True, "instagram", vocab("account", "accounts", "action", "actions", "like", "liked", "activity"),
    frozenset(),
    ("Instagram → Profile → ☰ → Accounts Center → Your information and permissions → Export your information",
     "Create export → your Instagram → Export to device: All time, JSON, low media quality",
     "Add the .zip (or every part) here when Instagram emails you"),
    "a few hours to a few days", issue=6, family="social", auth="file", order=4,
    image_hosts=())


class Instagram(Connector):
    manifest = MANIFEST

    def ingest(self, **_) -> None:
        from . import ingest as ig
        conn = self.connect()
        try:
            res = ig.ingest(conn, self.folder)
        except (FileNotFoundError, ValueError, ImportRejected) as e:
            raise ConnectorError(str(e)) from None
        self.out(f"Instagram: {res.get('like', 0):,} likes, {res.get('message', 0):,} messages, {res.get('comment', 0):,} comments, "
                 f"{res.get('follow', 0):,} follows, {res.get('post', 0) + res.get('story', 0):,} posts and stories")
        self._derive(conn)

    def build(self) -> None:
        self._derive(self.connect())

    def _derive(self, conn) -> None:
        from . import ingest as ig
        n = ig.build(conn, self.cfg.tz)
        first = conn.execute("SELECT value FROM meta WHERE key = 'first_action'").fetchone()
        self.out(f"Built: {n:,} of your actions since {first[0] if first else '?'}")


CONNECTOR = Instagram
