# Contributing

Read [ROADMAP.md](ROADMAP.md) first: it has the definition of done and the security rules.

## Setup

```bash
python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt   # bin/pip on macOS/Linux
.venv/Scripts/pre-commit install      # gitleaks, ruff and bandit on every commit
cd frontend && npm ci
```

## Checks (CI runs the same on every push and PR)

```bash
pytest -q
pre-commit run --all-files
cd frontend && npm run build && npm audit --audit-level=high
```

## Adding a platform

```bash
python scripts/new_connector.py letterboxd "Letterboxd" --family video
python -m pytest backend/tests/test_connectors.py
```

This creates `backend/ytw/connectors/<id>/__init__.py` (a manifest plus a working CSV importer) and `backend/tests/fixtures/<id>/history.csv`. Then:

1. Replace the sample fixture with a small, **made-up** file in the platform's real export format (never a real export).
2. Adapt `build()` to parse it into `View` / `Item` / `Creator` rows (`connectors/store.py`) and fill in the manifest's TODOs.
3. Keep `pytest` green: the contract in `backend/tests/connector_contract.py` checks re-imports don't duplicate, unknown fields don't break the import, there's no network use, and the API and Wrapped answer for the platform.
4. Add its look as one entry in `frontend/src/themes.tsx` (see *Designing a platform* below) and its Wrapped personalities in `personalities-<id>.toml` if it needs its own.

Network calls go through `ytw/net.py`, secrets through `ytw/secrets.py` (list their names in the manifest).

Platforms with a sign-in (Spotify, Trakt, Google, Strava…) declare an `OAuthSpec` in the manifest: https endpoints, the **fewest scopes** the stats need, and the secret name of the user's own app client ID (also listed in `secrets`). `ytw/oauth.py` does the rest: PKCE with a single-use `state`, the loopback redirect `http://127.0.0.1:<port>/oauth/callback` (register that in the provider's developer console), the device-code flow, refresh and revoke. A connector gets a token with `OAuth.access_token(id, spec)`. Live sources (Last.fm, Steam, Plex…) set `sync_every` in the manifest and implement `sync()`, fetching only what's new since `self.cursor(conn)` and saving the new position with `self.set_cursor(conn, …)`; `ytw/scheduler.py` runs it in the background, backs off on failures and pauses after 5 in a row. Never sign in to a real account in tests: use a fake provider like `tests/test_oauth.py`.

## Designing a platform

Pages come from the platform's **family**: `videos` (YouTube) or `shows` (Netflix, Crunchyroll, Prime Video, Disney+, Trakt…). Music, games and social families arrive with their chapters. A new platform in an existing family is **one entry in `frontend/src/themes.tsx`**, not new pages:

- `family`, `creatorShape` (round avatars or 2:3 posters), the hub `tile`, the Wrapped look
- shows family: a `shell` (start from `NETFLIX_LOOK` or `CRUNCHYROLL_LOOK` and change what differs), `colors` for the page and `chart` colors; `anime: true` for the anime layouts

Checklist:

1. **Research the real app first** (web and phone): its colors, type, corner radius, nav pattern, icon style. Aim for "feels like the service", not a copy: our own **W** mark, free fonts, none of its logos, artwork or trademarks.
2. **It stays a stats page.** No Play, Continue watching, My List or other controls that pretend to stream.
3. **No cross-platform leaks**: no other service's name, colors or wording. Use the platform's name from the API, never a hard-coded one.
4. **Charts**: one-hue ramp in the accent, dark to bright, readable on the card color.
5. **Check spacing and padding at phone (375px) and laptop (1300px) widths**, every page and the Wrapped story, hover and open-menu states included.
6. Changing a shared shell or page? Screenshot every platform before and after and compare: the others must not move.

## Dependencies

Prefer the standard library. Before adding any package:

1. Check it is the real, maintained project (right name on PyPI/npm, linked source repo, real download history). Names suggested by an AI can be invented or typo-squatted.
2. Add it to `requirements.in` (or `requirements-dev.in` for tooling), then relock both with hashes:

   ```bash
   uv pip compile requirements.in --universal --python-version 3.12 --generate-hashes -o requirements.txt
   uv pip compile requirements-dev.in --universal --python-version 3.12 --generate-hashes -o requirements-dev.txt
   ```

3. Frontend: `npm install --save-exact <pkg>` and commit `package-lock.json`.

All network calls go through `backend/ytw/net.py`, and secrets through `backend/ytw/secrets.py`; tests enforce the first.
