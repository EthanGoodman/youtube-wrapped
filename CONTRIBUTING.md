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
4. Add its theme in `frontend/src/index.css` and its Wrapped personalities in `personalities-<id>.toml` if it needs its own.

Network calls go through `ytw/net.py`, secrets through `ytw/secrets.py` (list their names in the manifest).

Platforms with a sign-in (Spotify, Trakt, Google, Strava…) declare an `OAuthSpec` in the manifest: https endpoints, the **fewest scopes** the stats need, and the secret name of the user's own app client ID (also listed in `secrets`). `ytw/oauth.py` does the rest: PKCE with a single-use `state`, the loopback redirect `http://127.0.0.1:<port>/oauth/callback` (register that in the provider's developer console), the device-code flow, refresh and revoke. A connector gets a token with `OAuth.access_token(id, spec)`. Live sources (Last.fm, Steam, Plex…) set `sync_every` in the manifest and implement `sync()`, fetching only what's new since `self.cursor(conn)` and saving the new position with `self.set_cursor(conn, …)`; `ytw/scheduler.py` runs it in the background, backs off on failures and pauses after 5 in a row. Never sign in to a real account in tests: use a fake provider like `tests/test_oauth.py`.

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
