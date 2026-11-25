"""Talk to Epic Games: your playtime per game, your library (names, art) and your achievements, saved as the games
family's small JSON files in data/epic/ (see connectors/games.py) for ingest to read.

Epic has no public API for this. These are the Epic Games Launcher's own endpoints, read with the launcher's public
client id, the way the open-source launchers Legendary, Heroic and Playnite do. Read-only: nothing is ever written
to your account. You sign in yourself in your browser; Epic shows a one-time code that you save with
`python backend/cli.py secrets set EPIC_AUTH_CODE`, and the first fetch trades it for a refresh token kept in the OS
keychain (EPIC_REFRESH_TOKEN). Each fetch refreshes it, so the daily sync keeps it alive.

Only what the stats use is saved: per game its name, minutes, art and store link; per achievement its name,
description, unlock time and rarity. No friends, purchases, email or other account data.
"""
from __future__ import annotations

import base64
import json
import re
from datetime import date, datetime
from pathlib import Path
from typing import Callable

from ... import net

# The Epic Games Launcher's public OAuth client (published in Legendary, Heroic and Playnite). It identifies the
# launcher app, not you; it grants nothing without your own sign-in.
LAUNCHER_CLIENT = ("34a02cf8f4414e29b15921876da36f9a", "daafbccc737745039dffe53d94fc76cf")  # gitleaks:allow
LOGIN_URL = f"https://www.epicgames.com/id/api/redirect?clientId={LAUNCHER_CLIENT[0]}&responseType=code"
OAUTH = "https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token"
LIBRARY = "https://library-service.live.use1a.on.epicgames.com/library/api/public/"
CATALOG = "https://catalog-public-service-prod06.ol.epicgames.com/catalog/api/shared/namespace/{ns}/bulk/items"
GRAPHQL = "https://launcher.store.epicgames.com/graphql"
STORE_UA = "EpicGamesLauncher/14.0.8-22004686+++Portal+Release-Live"

# (method, url, options) -> (HTTP status, parsed JSON body or None)
Http = Callable[[str, str, dict], tuple[int, object]]


class EpicError(Exception):
    pass


class SignInNeeded(EpicError):
    """The saved sign-in is missing, used, or expired: the message says how to get a new code."""


SIGN_IN = (f"Sign in to Epic in your browser and open {LOGIN_URL} - copy the authorizationCode it shows, then run "
           "python backend/cli.py secrets set EPIC_AUTH_CODE and fetch again (the code works once, for a few minutes)")


def http() -> Http:
    net.client.rate_limit("library-service.live.use1a.on.epicgames.com", 0.3)
    net.client.rate_limit("catalog-public-service-prod06.ol.epicgames.com", 0.3)
    net.client.rate_limit("launcher.store.epicgames.com", 0.5)

    def call(method: str, url: str, opts: dict) -> tuple[int, object]:
        try:
            r = net.request(method, url, timeout=25, retries=3, **opts)
        except net.NetError as e:
            raise EpicError(str(e)) from None
        return r.status, r.json(None)
    return call


def auth_code(pasted: str) -> str:
    """The code from what was pasted: the bare code, or the whole JSON page Epic shows."""
    m = re.search(r'"authorizationCode"\s*:\s*"([0-9a-fA-F]{20,64})"', pasted)
    code = m.group(1) if m else pasted.strip().strip('"')
    if not re.fullmatch(r"[0-9a-fA-F]{20,64}", code):
        raise SignInNeeded("That isn't an Epic authorization code. " + SIGN_IN)
    return code


def sign_in(call: Http, *, code: str | None = None, refresh: str | None = None) -> dict:
    """A session from a one-time code or a saved refresh token: {access_token, refresh_token, account_id}."""
    form = ({"grant_type": "authorization_code", "code": code, "token_type": "eg1"} if code
            else {"grant_type": "refresh_token", "refresh_token": refresh, "token_type": "eg1"})
    basic = base64.b64encode(":".join(LAUNCHER_CLIENT).encode()).decode()
    status, body = call("POST", OAUTH, {"form": form, "headers": {"Authorization": f"basic {basic}"}})
    body = body if isinstance(body, dict) else {}
    if status >= 500:
        raise EpicError(f"Epic's sign-in service answered {status}; try again later")
    if status >= 400 or "errorCode" in body or not body.get("access_token"):
        err = str(body.get("errorCode", status))
        if "corrective_action" in err:
            raise SignInNeeded("Epic wants you to accept something on your account first (sign in at epicgames.com), then: " + SIGN_IN)
        raise SignInNeeded(("That code didn't work (they're single-use and expire after a few minutes). " if code
                            else "Your Epic sign-in expired. ") + SIGN_IN)
    if not re.fullmatch(r"[0-9a-f]{32}", str(body.get("account_id", ""))):
        raise EpicError("Epic's sign-in answer had no account id")
    return {"access_token": body["access_token"], "refresh_token": body.get("refresh_token") or refresh,
            "account_id": body["account_id"]}


def _get(call: Http, s: dict, url: str, params: dict | None = None) -> object:
    status, body = call("GET", url, {"params": params or {}, "headers": {"Authorization": f"bearer {s['access_token']}"}})
    if status == 401:
        raise SignInNeeded("Epic ended the session. " + SIGN_IN)
    if status == 429:
        raise EpicError("Epic is rate-limiting; what was saved is kept, run it again later")
    if status >= 400:
        raise EpicError(f"Epic HTTP {status} for {url.split('?')[0]}")
    return body


def playtime(call: Http, s: dict) -> dict[str, int]:
    """Lifetime minutes per game, by its app name (only games you've played)."""
    body = _get(call, s, LIBRARY + f"playtime/account/{s['account_id']}/all")
    out: dict[str, int] = {}
    for p in body if isinstance(body, list) else []:
        app = p.get("artifactId") if isinstance(p, dict) else None
        secs = p.get("totalTime") if isinstance(p, dict) else None
        if isinstance(app, str) and re.fullmatch(r"[\w.\-]{1,200}", app) and isinstance(secs, (int, float)) and secs >= 60:
            out[app] = out.get(app, 0) + int(secs // 60)
    return out


def library(call: Http, s: dict) -> dict[str, dict]:
    """app name -> {namespace, catalog id}, for every item in your library (games, DLC, apps)."""
    out: dict[str, dict] = {}
    cursor = None
    for _ in range(100):                        # 100 pages of 1,000 is far more than any library
        body = _get(call, s, LIBRARY + "items", {"includeMetadata": "true", **({"cursor": cursor} if cursor else {})})
        body = body if isinstance(body, dict) else {}
        for r in body.get("records") or []:
            if isinstance(r, dict) and isinstance(r.get("appName"), str) and r.get("namespace") and r.get("catalogItemId"):
                out[r["appName"]] = {"namespace": str(r["namespace"]), "catalog": str(r["catalogItemId"])}
        cursor = (body.get("responseMetadata") or {}).get("nextCursor")
        if not cursor:
            break
    return out


_POSTER = ("DieselGameBoxTall", "OfferImageTall", "DieselGameBoxPortrait", "Thumbnail")
_HEADER = ("DieselGameBox", "OfferImageWide", "DieselStoreFrontWide", "DieselGameBoxWide")


def _image(images: list, kinds: tuple[str, ...]) -> str | None:
    by = {i.get("type"): i.get("url") for i in images if isinstance(i, dict)}
    for k in kinds:
        if isinstance(by.get(k), str) and by[k].startswith("https://"):
            return by[k]
    return None


def catalog(call: Http, s: dict, namespace: str, item: str) -> dict:
    """A game's title, cover art and store link."""
    body = _get(call, s, CATALOG.format(ns=namespace), {"id": item, "country": "US", "locale": "en-US",
                                                         "includeMainGameDetails": "true"})
    c = (body or {}).get(item) if isinstance(body, dict) else None
    if not isinstance(c, dict):
        return {}
    images = c.get("keyImages") or []
    slug = ((c.get("customAttributes") or {}).get("com.epicgames.app.productSlug") or {}).get("value")
    return {"name": str(c.get("title") or "")[:300] or None, "poster": _image(images, _POSTER), "header": _image(images, _HEADER),
            "url": f"https://store.epicgames.com/p/{slug}" if isinstance(slug, str) and re.fullmatch(r"[\w\-/]{1,200}", slug) else None}


ACHIEVEMENTS_Q = """query Achievement($sandboxId: String!, $locale: String!) { Achievement {
  productAchievementsRecordBySandbox(sandboxId: $sandboxId, locale: $locale) {
    achievements { achievement { name unlockedDisplayName unlockedDescription rarity { percent } } } } } }"""
PLAYER_Q = """query PlayerAchievement($epicAccountId: String!, $sandboxId: String!) { PlayerAchievement {
  playerAchievementGameRecordsBySandbox(epicAccountId: $epicAccountId, sandboxId: $sandboxId) {
    records { playerAchievements { playerAchievement { achievementName unlocked unlockDate } } } } } }"""


def _gql(call: Http, s: dict, query: str, variables: dict) -> dict:
    status, body = call("POST", GRAPHQL, {"json": {"query": query, "variables": variables},
                                          "headers": {"Authorization": f"bearer {s['access_token']}", "User-Agent": STORE_UA}})
    return body.get("data") or {} if status < 400 and isinstance(body, dict) else {}


def _epoch(iso) -> int | None:
    try:
        return int(datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp())
    except ValueError:
        return None


def achievements(call: Http, s: dict, namespace: str) -> tuple[list[dict], dict[str, float]]:
    """Every achievement of a game with your unlock time, and how rare each is. Empty when the game has none
    (or Epic's store doesn't answer: achievements are a bonus, never a reason to fail)."""
    rec = ((_gql(call, s, ACHIEVEMENTS_Q, {"sandboxId": namespace, "locale": "en-US"}).get("Achievement") or {})
           .get("productAchievementsRecordBySandbox") or {})
    defs = [a.get("achievement") for a in rec.get("achievements") or [] if isinstance(a, dict)]
    defs = [d for d in defs if isinstance(d, dict) and isinstance(d.get("name"), str)]
    if not defs:
        return [], {}
    mine = {}
    player = ((_gql(call, s, PLAYER_Q, {"sandboxId": namespace, "epicAccountId": s["account_id"]}).get("PlayerAchievement") or {})
              .get("playerAchievementGameRecordsBySandbox") or {})
    for r in player.get("records") or []:
        for p in (r or {}).get("playerAchievements") or []:
            p = (p or {}).get("playerAchievement") or {}
            if p.get("unlocked") and isinstance(p.get("achievementName"), str):
                mine[p["achievementName"]] = _epoch(p.get("unlockDate"))
    rarity = {}
    for d in defs:
        pct = (d.get("rarity") or {}).get("percent")
        if isinstance(pct, (int, float)):
            rarity[d["name"]] = round(float(pct), 2)
    return ([{"api": d["name"], "name": d.get("unlockedDisplayName"), "desc": d.get("unlockedDescription"),
              "unlocked": mine.get(d["name"])} for d in defs], rarity)


def _safe(app: str) -> str:
    return re.sub(r"[^\w.\-]", "_", app)[:200]


def fetch_all(folder: Path, call: Http, s: dict, today: date, progress: Callable[[str], None] = lambda s: None) -> dict:
    """Save today's snapshot of every played game's minutes, then refresh the details (name, art, achievements)
    of games that are new or were played since they were last saved. Earlier snapshots stay: they're the history."""
    (folder / "snapshots").mkdir(parents=True, exist_ok=True)
    (folder / "games").mkdir(parents=True, exist_ok=True)
    minutes = playtime(call, s)
    lib = library(call, s) if minutes else {}
    todo, names = [], {}
    for app, m in sorted(minutes.items(), key=lambda kv: (-kv[1], kv[0])):
        path = folder / "games" / f"{_safe(app)}.json"
        old = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
        names[app] = (old or {}).get("name") or app
        if old is None or old.get("minutes") != m:
            todo.append((app, path, old))
    for n, (app, path, old) in enumerate(todo, 1):
        where = lib.get(app)
        info = catalog(call, s, where["namespace"], where["catalog"]) if where else {}
        ach, rarity = achievements(call, s, where["namespace"]) if where else ([], {})
        names[app] = info.get("name") or (old or {}).get("name") or app
        path.write_text(json.dumps({"id": app, "name": names[app], "minutes": minutes[app], "achievements": ach, "rarity": rarity,
                                    "genres": (old or {}).get("genres") or [],
                                    **{k: info.get(k) or (old or {}).get(k) for k in ("poster", "header", "url")}}), encoding="utf-8")
        if n % 5 == 0 or n == len(todo):
            progress(f"games {n:,}/{len(todo):,}")
    games = [{"id": app, "name": names[app], "minutes": m, "last_played": None} for app, m in sorted(minutes.items())]
    (folder / "snapshots" / f"{today.isoformat()}.json").write_text(json.dumps({"day": today.isoformat(), "games": games}),
                                                                   encoding="utf-8")
    return {"played": len(games), "refreshed": len(todo), "hours": round(sum(minutes.values()) / 60),
            "in_library": len(lib), "unknown": sum(1 for app in minutes if app not in lib)}
