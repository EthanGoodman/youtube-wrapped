"""Data sources: add, refresh and delete each platform's data from the browser (no CLI needed).

- Jobs: a connector step (ingest / build / enrich / fetch) runs in a background thread, one per
  platform at a time. Its progress lines are kept for the page to poll; it can be cancelled
  (it stops at the next progress line).
- Upload: the file streams to disk under the size limit, must pass the safe importer, is kept
  under data/<id>/imports/<random>/ and imported straight away.
- Secrets: written to the OS keychain; the API only ever says which names are set, never values.
- Delete: one platform (its database, its data/<id>/ folder and its secrets) or everything.
"""
from __future__ import annotations

import logging
import shutil
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from fastapi import FastAPI, HTTPException, Request

import html

from fastapi.responses import HTMLResponse

from . import platforms, secrets
from .oauth import OAuth, OAuthError, OAuthSpec
from .config import Config
from .connectors.base import Connector, ConnectorError
from .imports import DEFAULT as LIMITS
from .imports import ImportRejected, Source, safe_basename, store_original

log = logging.getLogger("ytw.sources")
STEPS = ("ingest", "build", "enrich", "fetch")
MAX_LINES = 400


class Cancelled(Exception):
    pass


@dataclass
class Job:
    platform: str
    step: str
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    state: str = "running"                     # running | done | failed | cancelled
    lines: list[str] = field(default_factory=list)
    error: str | None = None
    started: float = field(default_factory=time.time)
    ended: float | None = None
    cancel: threading.Event = field(default_factory=threading.Event)

    def log(self, line: str) -> None:
        if self.cancel.is_set():
            raise Cancelled()
        for part in str(line).strip("\n").splitlines() or [""]:
            self.lines.append(secrets.redact(part))
        del self.lines[:-MAX_LINES]

    def to_dict(self) -> dict:
        return {"id": self.id, "platform": self.platform, "step": self.step, "state": self.state,
                "lines": self.lines[-60:], "error": self.error, "started": self.started, "ended": self.ended,
                "cancelling": self.cancel.is_set() and self.state == "running"}


class Busy(Exception):
    pass


class JobRunner:
    def __init__(self, cfg: Config, on_finish: Callable[[str], None] = lambda pid: None):
        self.cfg = cfg
        self.on_finish = on_finish
        self.jobs: dict[str, Job] = {}          # latest job per platform
        self.lock = threading.Lock()

    def busy(self, pid: str) -> bool:
        j = self.jobs.get(pid)
        return j is not None and j.state == "running"

    def start(self, pid: str, step: str, before: Callable[[Connector], None] | None = None) -> Job:
        cls = platforms.CONNECTORS.get(pid)
        if cls is None:
            raise KeyError(pid)
        with self.lock:
            if self.busy(pid):
                raise Busy(pid)
            job = self.jobs[pid] = Job(pid, step)
        threading.Thread(target=self._run, args=(job, cls, before), name=f"job-{pid}-{step}", daemon=True).start()
        return job

    def _run(self, job: Job, cls: type[Connector], before) -> None:
        c = cls(self.cfg, out=job.log)
        try:
            if before:
                before(c)
            getattr(c, job.step)()
            job.state = "done"
        except Cancelled:
            job.state = "cancelled"
        except (ConnectorError, ImportRejected) as e:
            job.state, job.error = "failed", str(e).strip()
        except Exception:  # never let a worker thread die silently
            log.exception("%s %s failed", job.platform, job.step)
            job.state, job.error = "failed", "Something went wrong; the details are in the server's log."
        finally:
            c.close()
            job.ended = time.time()
            self.on_finish(job.platform)

    def cancel(self, pid: str) -> Job | None:
        j = self.jobs.get(pid)
        if j and j.state == "running":
            j.cancel.set()
        return j


def _status(cfg: Config, path: Path) -> dict:
    out = {"has_data": False, "rows": 0, "first_date": None, "last_date": None, "built_at": None}
    if not path.exists():
        return out
    try:
        c = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            n, first, last = c.execute("SELECT COUNT(*), MIN(local_date), MAX(local_date) FROM watches").fetchone()
            built = c.execute("SELECT value FROM meta WHERE key = 'built_at'").fetchone()
        finally:
            c.close()
        out.update(has_data=bool(n), rows=n, first_date=first, last_date=last, built_at=built[0] if built else None)
    except sqlite3.Error:
        pass
    return out


def _files(folder: Path) -> int:
    """Export files kept for this platform (uploads and files placed by hand)."""
    if not folder.is_dir():
        return 0
    return sum(1 for p in folder.rglob("*") if p.is_file() and p.suffix.lower() in (".zip", ".json", ".csv", ".js"))


def _overrides(cls: type[Connector], step: str) -> bool:
    return getattr(cls, step) is not getattr(Connector, step)


def add_routes(app: FastAPI, cfg: Config, path_for: Callable[[str], Path], release: Callable[[str], None]) -> JobRunner:
    """Mount the /api/sources and /api/secrets routes. `release(pid)` closes the API's open
    handles on a platform's database (before it's replaced or deleted)."""
    runner = JobRunner(cfg)
    auth = OAuth()
    app.state.oauth = auth

    def connector_cls(pid: str) -> type[Connector]:
        cls = platforms.CONNECTORS.get(pid)
        if cls is None:
            raise HTTPException(404, f"unknown platform: {pid}")
        return cls

    def describe(cls: type[Connector]) -> dict:
        m = cls.manifest
        st = secrets.store()
        names = st.names()
        return {
            "id": m.id, "name": m.name, "family": m.family, "auth": m.auth, "official": m.official,
            "export_steps": list(m.export_steps), "export_wait": m.export_wait,
            "folder": f"data/{m.id}/",
            "secrets": [{"name": s, "label": secrets.KNOWN.get(s, s), "set": s in names, "where": names.get(s)}
                        for s in m.secrets],
            "can": {"upload": m.auth == "file", "fetch": _overrides(cls, "fetch"), "enrich": _overrides(cls, "enrich")},
            "status": {**_status(cfg, path_for(m.id)), "files": _files(cfg.platform_dir(m.id))},
            "job": runner.jobs[m.id].to_dict() if m.id in runner.jobs else None,
            "oauth": {"connected": auth.connected(m.id), "scopes": list(m.oauth.scopes),
                      "device": bool(m.oauth.device_url), "redirect_path": "/oauth/callback"} if m.oauth else None,
        }

    def start(pid: str, step: str, before=None) -> dict:
        try:
            return runner.start(pid, step, before).to_dict()
        except Busy:
            raise HTTPException(409, "something is already running for this platform") from None

    @app.get("/api/sources")
    def list_sources():
        keychain = "your OS keychain" if secrets.store().kr else "a private file in data/ (no OS keychain found)"
        return {"keychain": keychain,
                "sources": [describe(cls) for cls in sorted(platforms.CONNECTORS.values(), key=lambda c: c.manifest.order)]}

    @app.get("/api/sources/{pid}")
    def get_source(pid: str):
        return describe(connector_cls(pid))

    @app.post("/api/sources/{pid}/run/{step}")
    def run_step(pid: str, step: str):
        cls = connector_cls(pid)
        if step not in STEPS or (step in ("fetch", "enrich") and not _overrides(cls, step)):
            raise HTTPException(404, f"{cls.manifest.name} has no {step} step")
        return start(pid, step)

    @app.post("/api/sources/{pid}/cancel")
    def cancel(pid: str):
        connector_cls(pid)
        j = runner.cancel(pid)
        return j.to_dict() if j else None

    @app.post("/api/sources/{pid}/upload")
    async def upload(pid: str, request: Request):
        cls = connector_cls(pid)
        if cls.manifest.auth != "file":
            raise HTTPException(400, f"{cls.manifest.name} doesn't take uploads")
        if runner.busy(pid):
            raise HTTPException(409, "something is already running for this platform")
        size = request.headers.get("content-length")
        if size and size.isdigit() and int(size) > LIMITS.max_upload:
            raise HTTPException(413, "file too large")
        name = safe_basename(request.headers.get("x-filename", "upload"))
        incoming = cfg.platform_dir(pid) / "imports" / ".incoming"
        incoming.mkdir(parents=True, exist_ok=True)
        tmp = incoming / f"{uuid.uuid4().hex}-{name}"
        written = 0
        try:
            with tmp.open("wb") as f:
                async for chunk in request.stream():
                    written += len(chunk)
                    if written > LIMITS.max_upload:
                        raise HTTPException(413, "file too large")
                    f.write(chunk)
            if not written:
                raise HTTPException(400, "empty file")
            try:
                with Source(tmp) as src:
                    if src.kind not in ("zip", "json", "js", "text"):
                        raise ImportRejected("unsupported file type")
            except ImportRejected as e:
                raise HTTPException(400, f"Can't import that file: {e}") from None
            kept = store_original(tmp, cfg.platform_dir(pid), move=True, name=name)
        finally:
            tmp.unlink(missing_ok=True)
        job = start(pid, "ingest")
        job["file"] = kept.name
        return job

    @app.put("/api/secrets/{name}")
    async def set_secret(name: str, request: Request):
        allowed = {s for cls in platforms.CONNECTORS.values() for s in cls.manifest.secrets}
        if name not in allowed:
            raise HTTPException(404, "no platform uses that secret")
        body = await request.body()
        if len(body) > 16_384:
            raise HTTPException(413, "too long")
        try:
            value = (await request.json()).get("value", "")
        except ValueError:
            raise HTTPException(400, "send JSON: {\"value\": \"...\"}") from None
        if not isinstance(value, str) or not value.strip():
            raise HTTPException(400, "empty value")
        try:
            secrets.store().set(name, value)
        except secrets.SecretsError as e:
            raise HTTPException(500, str(e)) from None
        return {"name": name, "set": True, "where": secrets.store().where}

    @app.delete("/api/secrets/{name}")
    def delete_secret(name: str):
        allowed = {s for cls in platforms.CONNECTORS.values() for s in cls.manifest.secrets}
        if name not in allowed:
            raise HTTPException(404, "no platform uses that secret")
        return {"name": name, "deleted": secrets.store().delete(name)}

    def wipe(pid: str) -> list[str]:
        cls = connector_cls(pid)
        if runner.busy(pid):
            raise HTTPException(409, "cancel the running job first")
        release(pid)
        removed = []
        if cls.manifest.oauth and auth.connected(pid):
            auth.disconnect(pid, cls.manifest.oauth)      # revoke at the provider, then wipe the tokens
            removed.append("sign-in")
        db_path = path_for(pid)
        for p in (db_path, db_path.with_name(db_path.name + "-wal"), db_path.with_name(db_path.name + "-shm")):
            if p.exists():
                p.unlink()
                removed.append(p.name)
        folder = cfg.platform_dir(pid)
        root = cfg.data_root.resolve()
        if folder.exists():
            if folder.resolve().parent != root:          # never delete outside data/
                raise HTTPException(500, "unexpected data folder")
            shutil.rmtree(folder)
            removed.append(f"{folder.name}/")
        for s in cls.manifest.secrets:
            if secrets.store().delete(s):
                removed.append(s)
        runner.jobs.pop(pid, None)
        return removed

    # -- OAuth sign-ins (the person signs in themselves, in their own browser) ----------
    def spec_of(pid: str) -> OAuthSpec:
        spec = connector_cls(pid).manifest.oauth
        if spec is None:
            raise HTTPException(404, "this platform doesn't use a sign-in")
        return spec

    def specs() -> dict[str, OAuthSpec]:
        return {pid: cls.manifest.oauth for pid, cls in platforms.CONNECTORS.items() if cls.manifest.oauth}

    @app.post("/api/oauth/{pid}/start")
    def oauth_start(pid: str, request: Request):
        spec = spec_of(pid)
        # RFC 8252: loopback IP literal, the port this app is on
        redirect = f"http://127.0.0.1:{request.url.port or 80}/oauth/callback"
        try:
            return {"authorize_url": auth.start(pid, spec, redirect), "redirect_uri": redirect}
        except OAuthError as e:
            raise HTTPException(400, str(e)) from None

    @app.get("/oauth/callback", include_in_schema=False)
    def oauth_callback(state: str | None = None, code: str | None = None, error: str | None = None):
        try:
            pid = auth.finish(state, code, error, specs())
            name = platforms.PLATFORMS[pid].name
            title, text, status = f"Connected to {name}", "You can close this tab and go back to Wrapped.", 200
        except OAuthError as e:
            title, text, status = "Sign-in didn't work", str(e), 400
        page = (f"<!doctype html><meta charset=utf-8><title>{html.escape(title)}</title>"
                "<body style=\"font-family:system-ui;background:#0c0c0e;color:#f4f4f5;display:grid;place-items:center;"
                "min-height:100vh;margin:0\"><main style=\"max-width:28rem;padding:1.5rem;text-align:center\">"
                f"<h1>{html.escape(title)}</h1><p style=\"color:#aaaab2\">{html.escape(text)}</p>"
                "<p><a href=\"/sources\" style=\"color:#f4f4f5\">Back to Data sources</a></p></main>")
        return HTMLResponse(page, status_code=status, headers={"Cache-Control": "no-store"})

    @app.post("/api/oauth/{pid}/device/start")
    def oauth_device_start(pid: str):
        try:
            return auth.device_start(pid, spec_of(pid))
        except OAuthError as e:
            raise HTTPException(400, str(e)) from None

    @app.post("/api/oauth/{pid}/device/poll")
    def oauth_device_poll(pid: str):
        try:
            return {"status": auth.device_poll(pid, spec_of(pid))}
        except OAuthError as e:
            raise HTTPException(400, str(e)) from None

    @app.post("/api/oauth/{pid}/disconnect")
    def oauth_disconnect(pid: str):
        return {"revoked": auth.disconnect(pid, spec_of(pid)), "connected": False}

    @app.delete("/api/sources/{pid}")
    def delete_source(pid: str):
        return {"removed": wipe(pid)}

    @app.delete("/api/sources")
    def delete_everything():
        if any(runner.busy(pid) for pid in platforms.CONNECTORS):
            raise HTTPException(409, "cancel the running jobs first")
        removed = []
        for pid in platforms.CONNECTORS:
            removed += wipe(pid)
        return {"removed": removed}

    return runner
