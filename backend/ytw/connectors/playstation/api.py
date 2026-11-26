"""Talk to PlayStation Network: your played games (lifetime hours, first and last played, how many times) and your
trophies (each with when you earned it and how rare it is), saved as the games family's small JSON files in
data/playstation/ (see connectors/games.py).

Sony has no public API for this. These are the PlayStation app's own endpoints, the way the open-source libraries
psn-api and PSNAWP read them. Read-only. You sign in yourself in your browser, then copy the `npsso` value from
ca.account.sony.com/api/v1/ssocookie and save it with `python backend/cli.py secrets set PSN_NPSSO`; fetch trades
it for the app's own sign-in (PSN_REFRESH_TOKEN, in the OS keychain).

Only what the stats use is saved: per game its name, minutes, first/last played, play count and picture; per
trophy its name, description, type, when you earned it and how rare it is. No friends, messages or account data.
"""
from __future__ import annotations

import json
import re
import time
from datetime import date, datetime
from pathlib import Path
from typing import Callable

from ... import net

SONY_AUTH = "https://ca.account.sony.com/api/authz/v3/oauth/"
SSO_PAGE = "https://ca.account.sony.com/api/v1/ssocookie"
GAMELIST = "https://m.np.playstation.com/api/gamelist/v2/users/me/titles"
TROPHY = "https://m.np.playstation.com/api/trophy/v1/"
# the PlayStation app's public OAuth client (published in psn-api and PSNAWP); it identifies the app, not you
APP_CLIENT = "09515159-7237-4370-9b40-3806e67c0891"
APP_BASIC = "MDk1MTUxNTktNzIzNy00MzcwLTliNDAtMzgwNmU2N2MwODkxOnVjUGprYTV0bnRCMktxc1A="  # gitleaks:allow
REDIRECT = "com.scee.psxandroid.scecompcall://redirect"
SCOPE = "psn:mobile.v2.core psn:clientapp"

Http = Callable[[str, str, dict], tuple[int, object, dict]]   # (method, url, options) -> (status, json, headers)


class PsnError(Exception):
    pass


class SignInNeeded(PsnError):
    pass


SIGN_IN = ("Sign in at playstation.com in your browser, then open " + SSO_PAGE + " and copy the npsso value; save it with "
           "python backend/cli.py secrets set PSN_NPSSO and fetch again")


def http() -> Http:
    net.client.rate_limit("m.np.playstation.com", 0.4)
    net.client.rate_limit("ca.account.sony.com", 1.0)

    def call(method: str, url: str, opts: dict) -> tuple[int, object, dict]:
        try:
            r = net.request(method, url, timeout=25, retries=3, **opts)
        except net.NetError as e:
            raise PsnError(str(e)) from None
        return r.status, r.json(None), r.headers
    return call


def npsso_value(pasted: str) -> str:
    """The npsso from what was pasted: the bare value, or the whole {"npsso": "..."} line."""
    m = re.search(r'"npsso"\s*:\s*"([A-Za-z0-9]{40,100})"', pasted)
    v = m.group(1) if m else pasted.strip().strip('"')
    if not re.fullmatch(r"[A-Za-z0-9]{40,100}", v):
        raise SignInNeeded("That isn't a PlayStation npsso. " + SIGN_IN)
    return v


def _tokens(status: int, body, what: str) -> dict:
    body = body if isinstance(body, dict) else {}
    if status >= 500:
        raise PsnError(f"PlayStation's sign-in service answered {status}; try again later")
    if status >= 400 or not body.get("access_token"):
        raise SignInNeeded(f"PlayStation didn't accept the {what}. " + SIGN_IN)
    return {"access_token": body["access_token"], "refresh_token": body.get("refresh_token")}


def sign_in(call: Http, *, npsso: str | None = None, refresh: str | None = None) -> dict:
    """A session {access_token, refresh_token} from a saved refresh token, or from the npsso cookie."""
    headers = {"Authorization": f"Basic {APP_BASIC}"}
    if refresh:
        status, body, _ = call("POST", SONY_AUTH + "token", {"headers": headers, "form": {
            "refresh_token": refresh, "grant_type": "refresh_token", "token_format": "jwt", "scope": SCOPE}})
        return _tokens(status, body, "saved sign-in")
    if not npsso:
        raise SignInNeeded(SIGN_IN)
    status, _, hdrs = call("GET", SONY_AUTH + "authorize", {
        "params": {"access_type": "offline", "client_id": APP_CLIENT, "redirect_uri": REDIRECT, "response_type": "code", "scope": SCOPE},
        "headers": {"Cookie": f"npsso={npsso}"}, "follow_redirects": False})
    where = (hdrs or {}).get("location") or ""
    m = re.search(r"[?&]code=([^&]+)", where)
    if not m:
        raise SignInNeeded("PlayStation didn't accept the npsso (it may have expired). " + SIGN_IN)
    status, body, _ = call("POST", SONY_AUTH + "token", {"headers": headers, "form": {
        "code": m.group(1), "redirect_uri": REDIRECT, "grant_type": "authorization_code", "token_format": "jwt"}})
    return _tokens(status, body, "npsso")


def _get(call: Http, s: dict, url: str, params: dict | None = None) -> dict:
    status, body, _ = call("GET", url, {"params": params or {}, "headers": {"Authorization": f"Bearer {s['access_token']}"}})
    if status == 401:
        raise SignInNeeded("PlayStation ended the session. " + SIGN_IN)
    if status == 429:
        raise PsnError("PlayStation is rate-limiting; what was saved is kept, run it again later")
    if status == 404:
        return {}
    if status >= 400:
        raise PsnError(f"PlayStation HTTP {status} for {url.split('?')[0]}")
    return body if isinstance(body, dict) else {}


def _epoch(iso) -> int | None:
    try:
        return int(datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp()) if iso else None
    except ValueError:
        return None


def _minutes(duration) -> int:
    """PT243H18M48S -> minutes."""
    m = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?", str(duration or ""))
    if not m:
        return 0
    d, h, mi, _ = (float(x) if x else 0 for x in m.groups())
    return int(d * 1440 + h * 60 + mi)


_ID = re.compile(r"[A-Z0-9_]{4,40}")


def played_games(call: Http, s: dict) -> list[dict]:
    """PS4/PS5 games you've played: lifetime minutes, first/last played, play count, picture."""
    out, offset = [], 0
    for _ in range(50):
        body = _get(call, s, GAMELIST, {"categories": "ps4_game,ps5_native_game,pspc_game,unknown", "limit": 200, "offset": offset})
        for t in body.get("titles") or []:
            if not isinstance(t, dict) or not _ID.fullmatch(str(t.get("titleId", ""))):
                continue
            out.append({"id": t["titleId"], "name": str(t.get("localizedName") or t.get("name") or t["titleId"])[:300],
                        "minutes": _minutes(t.get("playDuration")), "first_played": _epoch(t.get("firstPlayedDateTime")),
                        "last_played": _epoch(t.get("lastPlayedDateTime")), "plays": int(t.get("playCount") or 0),
                        "platform": str(t.get("category") or ""), "poster": _https(t.get("localizedImageUrl") or t.get("imageUrl"))})
        offset = body.get("nextOffset")
        if not offset:
            break
    return out


def _https(v) -> str | None:
    return v if isinstance(v, str) and v.startswith("https://") else None


def trophy_titles(call: Http, s: dict) -> list[dict]:
    """Every game you have trophies in (PS3, Vita, PS4, PS5), newest trophy first."""
    out, offset = [], 0
    for _ in range(50):
        body = _get(call, s, TROPHY + "users/me/trophyTitles", {"limit": 800, "offset": offset})
        for t in body.get("trophyTitles") or []:
            if isinstance(t, dict) and _ID.fullmatch(str(t.get("npCommunicationId", ""))):
                out.append({"np": t["npCommunicationId"], "service": t.get("npServiceName") or "trophy",
                            "name": str(t.get("trophyTitleName") or t["npCommunicationId"])[:300],
                            "platform": str(t.get("trophyTitlePlatform") or ""), "icon": _https(t.get("trophyTitleIconUrl")),
                            "updated": t.get("lastUpdatedDateTime"), "earned": t.get("earnedTrophies") or {}})
        offset = body.get("nextOffset")
        if not offset:
            break
    return out


def trophy_ids_for(call: Http, s: dict, title_ids: list[str]) -> dict[str, str]:
    """titleId (CUSA…/PPSA…) -> its trophy set (NPWR…), 5 titles per call (the endpoint's limit)."""
    out = {}
    for i in range(0, len(title_ids), 5):
        body = _get(call, s, TROPHY + "users/me/titles/trophyTitles", {"npTitleIds": ",".join(title_ids[i:i + 5])})
        for t in body.get("titles") or []:
            sets = (t or {}).get("trophyTitles") or []
            if t.get("npTitleId") and sets and _ID.fullmatch(str(sets[0].get("npCommunicationId", ""))):
                out[t["npTitleId"]] = sets[0]["npCommunicationId"]
    return out


TYPES = ("platinum", "gold", "silver", "bronze")


def trophies(call: Http, s: dict, np: str, service: str) -> tuple[list[dict], dict[str, float]]:
    """A game's trophies: names and descriptions, which you earned and when, type, and how rare each is."""
    q = {"npServiceName": service}
    defs = _get(call, s, TROPHY + f"npCommunicationIds/{np}/trophyGroups/all/trophies", q).get("trophies") or []
    mine = _get(call, s, TROPHY + f"users/me/npCommunicationIds/{np}/trophyGroups/all/trophies", q).get("trophies") or []
    got = {str(t.get("trophyId")): t for t in mine if isinstance(t, dict)}
    out, rarity = [], {}
    for d in defs:
        if not isinstance(d, dict) or d.get("trophyId") is None:
            continue
        tid = str(d["trophyId"])
        m = got.get(tid, {})
        try:
            rarity[tid] = round(float(m.get("trophyEarnedRate")), 2)
        except (TypeError, ValueError):
            pass
        out.append({"api": tid, "name": d.get("trophyName"), "desc": d.get("trophyDetail"),
                    "type": d.get("trophyType") if d.get("trophyType") in TYPES else None,
                    "unlocked": _epoch(m.get("earnedDateTime")) if m.get("earned") else None})
    return out, rarity


def _safe(gid: str) -> str:
    return re.sub(r"[^\w.\-]", "_", gid)[:200]


def fetch_all(folder: Path, call: Http, s: dict, today: date, progress: Callable[[str], None] = lambda t: None) -> dict:
    """Save this check's snapshot of every game (played PS4/PS5 games with their hours, plus PS3/Vita games you have
    trophies in), then refresh the trophies of games whose trophies changed since they were last saved."""
    (folder / "snapshots").mkdir(parents=True, exist_ok=True)
    (folder / "games").mkdir(parents=True, exist_ok=True)
    played = played_games(call, s)
    sets = trophy_titles(call, s)
    np_of = trophy_ids_for(call, s, [g["id"] for g in played]) if sets else {}
    by_np = {t["np"]: t for t in sets}
    games: dict[str, dict] = {}
    for g in played:
        games[g["id"]] = {**g, "np": np_of.get(g["id"])}
    linked = {g["np"] for g in games.values() if g.get("np")}
    for t in sets:                                       # trophies without a played-games record (PS3, Vita, older)
        if t["np"] not in linked:
            games[t["np"]] = {"id": t["np"], "name": t["name"], "minutes": 0, "first_played": None, "last_played": None,
                              "plays": 0, "platform": t["platform"], "poster": t["icon"], "np": t["np"]}
    todo = []
    for g in games.values():
        t = by_np.get(g.get("np") or "")
        path = folder / "games" / f"{_safe(g['id'])}.json"
        old = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
        if old is None or (t and old.get("trophies_updated") != t["updated"]) or (old.get("poster") != g.get("poster")):
            todo.append((g, t, path, old))
    for n, (g, t, path, old) in enumerate(todo, 1):
        ach, rarity = trophies(call, s, t["np"], t["service"]) if t else ([], {})
        if t and not ach and old:
            ach, rarity = old.get("achievements") or [], old.get("rarity") or {}
        path.write_text(json.dumps({"id": g["id"], "name": g["name"], "achievements": ach, "rarity": rarity, "genres": [],
                                    "poster": g.get("poster") or (t or {}).get("icon"), "header": None, "url": None,
                                    "platform": g.get("platform"), "trophies_updated": (t or {}).get("updated")}), encoding="utf-8")
        if n % 5 == 0 or n == len(todo):
            progress(f"games {n:,}/{len(todo):,}")
    snap = [{"id": g["id"], "name": g["name"], "minutes": g["minutes"], "last_played": g["last_played"],
             "first_played": g["first_played"], "plays": g["plays"]} for g in sorted(games.values(), key=lambda g: g["id"])]
    (folder / "snapshots" / f"{today.isoformat()}.json").write_text(
        json.dumps({"day": today.isoformat(), "at": int(time.time()), "games": snap}), encoding="utf-8")
    return {"played": sum(1 for g in games.values() if g["minutes"]), "games": len(games), "refreshed": len(todo),
            "hours": round(sum(g["minutes"] for g in games.values()) / 60), "trophy_sets": len(sets)}
