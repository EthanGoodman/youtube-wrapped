"""Which games on different platforms (or two editions on one) are the same game, by name.

Names differ between stores ("Grand Theft Auto V (PlayStation®5)" vs "Grand Theft Auto V", "Rocket League®" vs
"Rocket League"), so names are cleaned first (symbols, platform tags, edition words) and then compared with a
longest-matching-blocks similarity (difflib). One guard on top: sequels look alike ("Black Ops III" vs "Black
Ops 4", "FIFA 17" vs "FIFA 18"), so the numbers and roman numerals in both names must be the same.

Renames the cleaning can't see ("Fall Guys: Ultimate Knockout" became "Fall Guys") and mistakes go in
game-matches.toml next to config.toml: groups of names that are the same game, or that must stay apart.
"""
from __future__ import annotations

import re
import tomllib
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path

THRESHOLD = 0.9

_PLATFORM_TAGS = re.compile(r"\b(?:playstation\s*\d*|ps[345]|xbox(?:\s*(?:one|series\s*[xs]))?|pc|windows)\s*(?:edition|version)?\b")
_EDITIONS = re.compile(r"\b(?:game of the year|goty|definitive|deluxe|complete|standard|ultimate|digital|gold|enhanced|anniversary)"
                       r"\s+edition\b|\bedition\b")
_ROMAN = re.compile(r"^(?=[ivx]+$)x{0,3}(ix|iv|v?i{0,3})$")


def clean(name: str) -> str:
    """'Grand Theft Auto V (PlayStation®5)' -> 'grand theft auto v'."""
    s = re.sub("[™®©℠]", " ", name)        # ™ ® © ℠ (NFKD would turn ™ into "TM")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\([^)]*\)|\[[^]]*\]", " ", s)            # (PlayStation®5), [PS4]
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = _PLATFORM_TAGS.sub(" ", s)
    s = _EDITIONS.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip()


def numerals(cleaned: str) -> frozenset[str]:
    """The numbers and roman numerals in a cleaned name: what tells sequels apart."""
    out = set()
    for t in cleaned.split():
        if t.isdigit():
            out.add(str(int(t)))
        elif _ROMAN.match(t) and t not in ("i",):
            out.add(t)
    return frozenset(out)


def similar(a: str, b: str) -> bool:
    """Two names are the same game: identical once cleaned, or nearly so with the same numerals."""
    ca, cb = clean(a), clean(b)
    if not ca or not cb:
        return False
    if ca == cb:
        return True
    if numerals(ca) != numerals(cb):
        return False
    return SequenceMatcher(None, ca, cb).ratio() >= THRESHOLD


def load_overrides(path: Path) -> tuple[list[set[str]], list[set[str]]]:
    """[[same]] names = [...] and [[different]] names = [...] from game-matches.toml (missing file: none)."""
    if not path.exists():
        return [], []
    with path.open("rb") as f:
        data = tomllib.load(f)
    norm = lambda group: {clean(n) for n in group.get("names", []) if isinstance(n, str) and clean(n)}  # noqa: E731
    return ([g for g in map(norm, data.get("same", [])) if len(g) > 1],
            [g for g in map(norm, data.get("different", [])) if len(g) > 1])


def group(names: list[str], same: list[set[str]] = (), different: list[set[str]] = ()) -> list[int]:
    """A group number for each name: names of the same game share one (union-find over every pair)."""
    parent = list(range(len(names)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    cleaned = [clean(n) for n in names]
    apart = lambda a, b: any(a in g and b in g and a != b for g in different)  # noqa: E731
    together = lambda a, b: any(a in g and b in g for g in same)  # noqa: E731
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a, b = cleaned[i], cleaned[j]
            if apart(a, b):
                continue
            if together(a, b) or similar(names[i], names[j]):
                parent[find(i)] = find(j)
    roots: dict[int, int] = {}
    return [roots.setdefault(find(i), len(roots)) for i in range(len(names))]
