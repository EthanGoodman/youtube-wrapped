# Roadmap

Goal: **one private hub for your lifetime stats and Wrapped across every platform you use.**
Local-first (runs on your computer, your data never leaves it), designed so it could become a hosted website later.

Every ticket is a GitHub issue; every chapter is a milestone. Work chapter by chapter, top to bottom inside a chapter.

## The big picture

```
 How data gets in                        The app (your computer)                         What you see
 ─────────────────                       ─────────────────────────                       ────────────
 Export files (ZIP/JSON/CSV) ──upload──▶ Safe importer ─┐
 Official APIs (Last.fm, Steam, Trakt) ─▶ Connectors ────┤─▶ normalize ─▶ SQLite per platform ─▶ Stats API ─▶ Platform pages
 OAuth (Spotify, Threads, Strava) ──────▶ (one template) │                                                  (themed page families)
 Wrapped Helper extension ──paired──────▶ Ingest API ────┘   Scheduler keeps live sources fresh             Hub: lifetime + Wrapped
   (Netflix, Crunchyroll, Prime Video…)                       Secrets in the OS keychain
```

Four ways data arrives, one pipeline after that:

| Route | Platforms | Experience |
|---|---|---|
| **Official/open API** (live) | Last.fm, ListenBrainz, Steam, Trakt, Simkl, Plex, Jellyfin, Bluesky, Threads | Connect once, stays up to date |
| **Wrapped Helper extension** (one click) | Netflix, Crunchyroll, Prime Video, Max (partial) | Click "Import" while logged in |
| **Export once + live feed** | Spotify, Apple Music, YouTube Music, Tidal, Deezer… (live via Last.fm) | Upload history once, then automatic |
| **Export upload** | YouTube (or scheduled Takeout), TikTok, Instagram, Facebook, X, Reddit, Discord, Snapchat, LinkedIn, Pinterest, Letterboxd, Goodreads, Strava | Upload a file from the Data sources page |

Locked services (Disney+, Hulu, Max, Apple TV+, Paramount+) come in **through Trakt**; Peacock, Twitch and Nintendo are iceboxed until a route exists.

## Chapters

| # | Chapter | What it delivers | Tickets |
|---|---|---|---|
| 1 | **Harden the base** | Fix today's security gaps before growing: DNS rebinding/CSRF, image relay SSRF, secrets out of `.env`, CI + supply chain, code audit, one shared HTTP client | #8–#13 |
| 2 | **Connector framework** | The reusable template: connector SDK, safe importer, Data sources page (no CLI), OAuth helper, scheduler, UI kit + page families (music, games, social, small) | #14–#23 |
| 3 | **Wrapped Helper extension** | One extension for Chrome, Edge and Firefox with per-site adapters and secure pairing; store publishing later | #24–#26 |
| 4 | **Music** | Last.fm first (the live hub), then Spotify, ListenBrainz, Apple Music, YouTube Music, Tidal, Deezer, SoundCloud, Amazon Music, Pandora | #32–#40, #3 |
| 5 | **Video & streaming** | Netflix + Crunchyroll via the extension, Prime Video, Trakt (gateway to Disney+/Hulu/Max/Apple TV+/Paramount+), Letterboxd, Plex, Jellyfin, Kodi, scheduled YouTube Takeout | #41–#58, #4 |
| 6 | **Gaming** | Steam, PlayStation, Xbox (Nintendo icebox) | #59–#62 |
| 7 | **Social** | TikTok, Instagram, Bluesky, Discord, Threads, Facebook, X, Reddit, Snapchat, LinkedIn, Pinterest | #5, #6, #63–#71 |
| 8 | **Life & learning** | Goodreads, Strava, Duolingo | #72–#74 |
| 9 | **The hub** | Lifetime stats across platforms, combined Wrapped, one-click desktop install, backups | #27–#29 |
| 10 | **Going online (later)** | Design only: hosted architecture, threat model, privacy/legal | #30–#31 |

Suggested first tickets: **#8 → #10 → #13 → #11 → #9 → #12**, then **#14** (connector SDK).

## How a ticket gets done (definition of done)

1. Read the ticket and its dependencies; post a short plan in the issue before coding.
2. Build on the shared pieces — never copy another platform's code:
   - data in: connector template (#14) + safe importer (#15) or the extension adapter (#24)
   - network: shared HTTP client (#13) only
   - credentials: secrets store (#10) / OAuth helper (#17) only
   - UI: PlatformShell theme + its page family (#19–#23)
3. Tests with saved fixtures, no network. Connector contract tests must pass.
4. Security checklist in the ticket ticked (below).
5. Check at phone and laptop widths; stats page, not a streaming clone.
6. README section for the platform; short commit message; push; close the issue.

## Rules that keep it secure and lean

**Security (every change)**
- Treat every file, API response and page the extension reads as hostile: schema-check, size-limit, never `eval`/`exec`/`pickle`, never `innerHTML` with platform data.
- SQL only with parameters. Every outbound request through `net.py` (timeouts, backoff, rate limits).
- Secrets only in the OS keychain; never in logs, URLs we log, errors, or git. Disconnect revokes and wipes.
- Server: localhost only, Host allowlist, install token + Origin check on personal-data and write routes, strict CSP, no CORS.
- Extension: least privilege (per-site optional permissions, no `<all_urls>`, no cookies), no remote code, paired token for talking to the app.
- Store only what the stats use; message contents off by default; one-click delete per platform and for everything.
- Dependencies: pinned with hashes, audited in CI; verify every new package is real (no invented names); prefer the standard library.

**Lean (every change)**
- New platform = manifest + parser/fetcher + theme config + fixtures. If it needs a new page component, it probably belongs to the family.
- No speculative abstractions; extract shared code on the second use, not the first.
- Delete code that a refactor makes unused in the same PR.

## Research behind this plan (November 2026)

- No platform offers US users a "sign in and get my full history" API; the EU-only data-portability APIs (Google, TikTok, Meta, LinkedIn, Apple) need company-grade app approval.
- Music's live route is scrobbling (Last.fm / ListenBrainz); streaming's is a browser extension on the logged-in site; Trakt (VIP) is the only route to Disney+, Hulu, Max, Apple TV+ and Paramount+.
- Each platform's ticket lists its sources.
