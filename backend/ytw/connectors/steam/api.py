"""Talk to Steam: your library (lifetime minutes per game, last played) and each game's achievements, saved as small
JSON files in data/steam/ for ingest.py to read. Official Web API with the user's own key (STEAM_API_KEY); the
profile's "Game details" must be public. Achievement rarity comes from the same API; genres from the store's public
app details (no key). Runs once a day as the background sync, so the snapshots build a dated history.

Only what the stats use is saved: per game its name, minutes and last-played time; per achievement its name,
description, unlock time and rarity. Nothing about friends or the profile.
"""
from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path
from typing import Callable

from ... import net

API = "https://api.steampowered.com/"
STORE = "https://store.steampowered.com/api/appdetails"

Fetcher = Callable[[str, dict], dict]


class SteamError(Exception):
    pass


def http_fetcher(key: str) -> Fetcher:
    """GET a Steam API or store URL with the key added for the Web API (never for the store)."""
    net.client.rate_limit("api.steampowered.com", 0.25)
    net.client.rate_limit("store.steampowered.com", 1.6)   # the store allows about 200 requests per 5 minutes

    def fetch(url: str, params: dict) -> dict:
        q = {**params, "key": key} if url.startswith(API) else params
        try:
            r = net.request("GET", url, params=q, timeout=25, retries=4)
        except net.NetError as e:
            raise SteamError(str(e)) from None
        if r.status in (401, 403) and url.startswith(API):
            raise SteamError("Steam rejected the API key - save it again with python backend/cli.py secrets set STEAM_API_KEY")
        if r.status == 429:
            raise SteamError("Steam is rate-limiting; what was saved is kept, run it again later")
        if r.status in (400, 404, 500):     # e.g. a game without stats answers 400
            return {}
        if not r.ok:
            raise SteamError(f"Steam HTTP {r.status}")
        return r.json({}) or {}
    return fetch


_PROFILE = re.compile(r"steamcommunity\.com/(id|profiles)/([^/?#\s]+)")


def resolve_id(fetch: Fetcher, who: str) -> str:
    """SteamID64 from a 64-bit id, a profile link, or a custom URL name."""
    who = who.strip()
    m = _PROFILE.search(who)
    kind, value = (m.group(1), m.group(2)) if m else ("profiles" if re.fullmatch(r"7656\d{13}", who) else "id", who)
    if kind == "profiles":
        if not re.fullmatch(r"7656\d{13}", value):
            raise SteamError(f"{value!r} isn't a SteamID64")
        return value
    r = fetch(API + "ISteamUser/ResolveVanityURL/v1/", {"vanityurl": value}).get("response") or {}
    if r.get("success") != 1 or not re.fullmatch(r"7656\d{13}", str(r.get("steamid", ""))):
        raise SteamError(f"No Steam profile named {value!r}. Use your profile link (steamcommunity.com/id/... or /profiles/...)")
    return str(r["steamid"])


def owned_games(fetch: Fetcher, steam_id: str) -> list[dict]:
    r = fetch(API + "IPlayerService/GetOwnedGames/v1/",
              {"steamid": steam_id, "include_appinfo": 1, "include_played_free_games": 1}).get("response") or {}
    if "games" not in r:
        raise SteamError("Steam returned no games: set Profile > Privacy > Game details to Public (and check the profile link)")
    return [{"appid": g["appid"], "name": str(g.get("name") or f"App {g['appid']}")[:300], "minutes": int(g.get("playtime_forever") or 0),
             "last_played": int(g.get("rtime_last_played") or 0) or None}
            for g in r["games"] if isinstance(g, dict) and isinstance(g.get("appid"), int)]


def game_details(fetch: Fetcher, steam_id: str, appid: int, genres_known: list[str] | None) -> dict:
    """Your achievements for a game (names, unlock times), how rare each is, and the game's genres."""
    ps = fetch(API + "ISteamUserStats/GetPlayerAchievements/v1/", {"steamid": steam_id, "appid": appid, "l": "english"})
    ach = [{"api": a["apiname"], "name": a.get("name"), "desc": a.get("description"),
            "unlocked": int(a["unlocktime"]) if a.get("achieved") and a.get("unlocktime") else None}
           for a in (ps.get("playerstats") or {}).get("achievements") or [] if isinstance(a, dict) and a.get("apiname")]
    rarity = {}
    if ach:
        pct = fetch(API + "ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/", {"gameid": appid})
        for a in (pct.get("achievementpercentages") or {}).get("achievements") or []:
            if isinstance(a, dict) and a.get("name"):
                try:
                    rarity[a["name"]] = round(float(a.get("percent")), 2)
                except (TypeError, ValueError):
                    pass
    genres = genres_known
    if genres is None:
        store = fetch(STORE, {"appids": appid, "filters": "genres"}).get(str(appid)) or {}
        genres = [g["description"] for g in ((store.get("data") or {}).get("genres") or [])
                  if isinstance(g, dict) and isinstance(g.get("description"), str)][:6]
    return {"appid": appid, "achievements": ach, "rarity": rarity, "genres": genres}


def fetch_all(folder: Path, fetch: Fetcher, steam_id: str, today: date, progress: Callable[[str], None] = lambda s: None) -> dict:
    """Save today's library snapshot, then refresh the details of every game that's new or was played since its
    details were last saved (most-played first). Earlier snapshots stay: they are the dated history."""
    (folder / "snapshots").mkdir(parents=True, exist_ok=True)
    (folder / "games").mkdir(parents=True, exist_ok=True)
    games = owned_games(fetch, steam_id)
    (folder / "snapshots" / f"{today.isoformat()}.json").write_text(json.dumps({"day": today.isoformat(), "games": games}), encoding="utf-8")
    todo = []
    for g in sorted(games, key=lambda g: (-g["minutes"], g["appid"])):
        if not g["minutes"]:
            continue                       # never played: nothing to show
        path = folder / "games" / f"{g['appid']}.json"
        old = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
        if old is None or old.get("minutes") != g["minutes"]:
            todo.append((g, old))
    for n, (g, old) in enumerate(todo, 1):
        d = game_details(fetch, steam_id, g["appid"], old.get("genres") if old else None)
        (folder / "games" / f"{g['appid']}.json").write_text(json.dumps({**d, "minutes": g["minutes"]}), encoding="utf-8")
        if n % 10 == 0 or n == len(todo):
            progress(f"games {n:,}/{len(todo):,}")
    return {"games": len(games), "played": sum(1 for g in games if g["minutes"]), "refreshed": len(todo),
            "hours": round(sum(g["minutes"] for g in games) / 60)}
