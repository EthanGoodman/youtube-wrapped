# YouTube Wrapped

A local, private stats dashboard and year-in-review ("Wrapped") for the apps you use, built from each app's own data export (think stats.fm, but for everything). Everything runs on your machine. The only things that leave it are metadata lookups (e.g. video/channel IDs to the YouTube Data API).

## Platforms

| Platform | Status |
|---|---|
| YouTube | ✅ Supported |
| Netflix | ✅ Supported (see [Netflix](#netflix)) |
| Spotify | ✅ Supported (see [Spotify](#spotify)) |
| Prime Video | Planned ([#4](https://github.com/EthanGoodman/youtube-wrapped/issues/4)) |
| TikTok | Planned ([#5](https://github.com/EthanGoodman/youtube-wrapped/issues/5)) |
| Instagram | Planned ([#6](https://github.com/EthanGoodman/youtube-wrapped/issues/6)) |
| Crunchyroll | ✅ Supported, unofficial (see [Crunchyroll](#crunchyroll)) |
| Steam | ✅ Supported (see [Steam](#steam)) |
| Epic Games | ✅ Supported, unofficial (see [Epic Games](#epic-games)) |

Every platform uses the same layout and look (top lists, patterns, records, evolution and a Wrapped story), worded for what it is: channels and videos, shows and episodes, artists and songs. The steps below cover YouTube.


## Setup

Requires Python 3.11+ and Node.js 20+.

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
python run.py
```

The first time, the app opens on **Data sources**: for each platform it shows how to download your data, a drop zone for the file (the `.zip`, `.json` or `.csv` exactly as downloaded), fields for API keys or cookies (saved in your OS keychain, never shown again), buttons to re-import or look up details, live progress, and **Delete data** (its database, its `data/<platform>/` folder and its keys). No terminal needed. The command-line steps below do the same thing.

## 1. Get your Takeout data

1. Go to [takeout.google.com](https://takeout.google.com), click **Deselect all**, then select **YouTube and YouTube Music**.
2. Click **All YouTube data included**, deselect everything except **history**.
3. Click **Multiple formats** and set **History** to **JSON**.
4. Export and download.
5. Put the downloaded `.zip` in this repo's `data/youtube/` folder as it is (no need to unzip). Or, if you prefer, copy these from `Takeout/YouTube and YouTube Music/history/` instead:
   - `watch-history.json` (required)
   - `search-history.json` (optional, enables search stats)

Exports are read without unpacking anything to disk, with limits on size, file count and nesting, so a broken or hostile file is refused with a message instead of crashing the import.

`data/` is gitignored, so your history is never committed. Each platform has its own folder (`data/youtube/`, …) and its own processed database (`data/youtube.db`), which can always be rebuilt from the exports. If you used an older version that kept files directly in `data/`, they're moved automatically on the next run.

## 2. Get a YouTube Data API key (free, optional)

Without a key the app still works, but with no durations, categories, genres or thumbnails, and with rougher watch-time estimates.

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create a project (any name).
2. Go to **APIs & Services → Library**, search for **YouTube Data API v3**, and click **Enable**.
3. Go to **APIs & Services → Credentials → Create credentials → API key**.
4. Optional but recommended: click the key, and under **API restrictions** restrict it to *YouTube Data API v3*.
5. Save it (you paste it at a hidden prompt; it's kept in your OS keychain, see [Secrets](#secrets)):

   ```bash
   python backend/cli.py secrets set YOUTUBE_API_KEY
   ```

The free quota is 10,000 units/day. Lookups are batched 50 IDs per unit, so even a very large history (~80k videos) takes about 2,000 units.

## 3. Load and enrich

```bash
python backend/cli.py ingest   # parse Takeout into data/youtube.db (~5s for 90k entries)
python backend/cli.py enrich   # fetch video/channel details from the API
```

- **Re-running is safe.** `ingest` skips entries it already has, so you can import a newer Takeout on top. `enrich` caches every result and never looks up the same ID twice.
- **Resumable.** If `enrich` stops (quota, Ctrl+C, network), run it again and it continues where it left off. Quota resets at midnight Pacific time.
- Useful flags: `enrich --budget 500` (cap units used today), `--skip-ads` (don't look up ad videos), `--retry-missing` (re-ask for videos the API didn't return before).

## 4. Open the dashboard

```bash
python run.py
```

That's the one command: it builds the frontend the first time (needs Node.js), then serves everything at **http://localhost:8000** and opens your browser on the **hub**: one tile per platform, with links to its stats and its Wrapped. YouTube lives at **http://localhost:8000/youtube** (older links without `/youtube` still work). It only listens on your own machine (`127.0.0.1`), never on your network. Options: `--port 9000`, `--no-browser`, `--rebuild`.

What's in it (every page follows the time-range chips at the top: 4 weeks, 6 months, this year, any year, lifetime, or a custom range, and compares against the previous equal period):

- **Home**: overview tiles, long-form/Shorts/Music split, top channels, top videos, top genres, watch clock, recent watches
- **Top**: ranked channels, videos, categories, genres and tags, by video count or estimated time, with rank changes
- **Patterns**: watch clock, day × hour heatmap, calendar, month by month, weekdays vs weekends
- **Records**: biggest days, longest binge, streaks, latest night, early-bird watches, milestones
- **Evolution**: #1 channel per year, a bar chart race, new discoveries, loyalty, channels you fell off, category/genre mix by year
- **Ads** and **Search history**
- Click any channel, video, category, genre or year for its own page

The **All · Videos · Shorts** switch (next to the time range) flips every page between everything, long-form videos only, and Shorts only. Channels show how many of their videos were Shorts. The ⚙ button has finer control (including YouTube Music and removed/private videos, whose type is unknown) and whether sleep/background audio adds to watch time. Filters live in the URL, so any view can be bookmarked.

Thumbnails and channel avatars load straight from YouTube's image servers, so your browser requests those images from Google. Fonts are bundled, so nothing else is loaded from the internet.

## 5. Wrapped

Click **Wrapped** in the top bar, pick a year, and get a Spotify-Wrapped-style story: about 15 full-screen cards (total time, your #1 channel and top 5 counting long-form videos only, your top Shorts channels, top video, top category and genres, Shorts vs long-form, watch clock, biggest day, streak, latest night, discovery of the year, your viewer personality, and a summary).

- Tap/click the right side or press → to go forward, left side or ← to go back, hold or press Space to pause.
- The ⬇ button saves the current card as a **1080×1920 PNG** (phone story size). On the last card, **Save share image** saves the summary.
- The **All · Videos · Shorts** switch under the story makes the whole Wrapped about everything, long-form videos only, or Shorts only (it starts on whatever the dashboard switch was set to). Cards made in Videos or Shorts mode are labelled "Videos only" / "Shorts only", including in saved images.
- Add `&still` to the URL to skip the animations.

**Viewer personality.** `personalities.toml` defines the personalities (Night Owl, Binger, Loyalist, Explorer, Shorts Scroller, Gamer, Sleep Streamer, ...). Each one looks at one metric for the year (for example `night_share`, the share of videos started between midnight and 5am) and has a threshold. The one that beats its threshold by the most wins, and the card says why. Edit the thresholds, wording or emoji and reload the page; the file lists every available metric.

To export cards with thumbnails, the server relays YouTube images through `/api/img` (browsers block exporting images from other sites). It only fetches from YouTube's image hosts.

**Developing the frontend:** run `python run.py --no-browser --dev` in one terminal and `npm run dev` in `frontend/` in another, then open http://localhost:5173 (hot reload; API calls are forwarded to port 8000).

## Netflix

1. Get your history, either or both:
   - **Quick (instant):** netflix.com/viewingactivity → *Download all* → `NetflixViewingHistory.csv`. Titles and dates only, so watch time is estimated and there are no times of day.
   - **Full (takes a few days):** netflix.com/account → *Download your personal information* → `CONTENT_INTERACTION/ViewingActivity.csv`. Adds exact start times and durations. If it has several profiles, set `[netflix] profile = "Your Name"` in `config.toml` (or pass `--profile`).
2. Put the file(s) in `data/netflix/`. Every `NetflixViewingHistory*.csv` and `ViewingActivity.csv` there is read and merged into one timeline, so you can add several accounts (e.g. `NetflixViewingHistory-account2.csv`). A viewing that appears in two files (same title, same day) counts once, and full-export rows win over quick-download rows.
3. Get a free TMDB token for posters, genres and runtimes: sign up at [themoviedb.org](https://www.themoviedb.org) → Settings → API → create a *Developer* key, then save the **API Read Access Token**:
   ```bash
   python backend/cli.py secrets set TMDB_TOKEN
   ```
4. Run:
   ```bash
   python backend/cli.py ingest --platform netflix
   python backend/cli.py enrich --platform netflix
   ```

TMDB matches are cached; if one is wrong, fix it in `data/netflix/overrides.toml` and rerun `enrich`:
```toml
[shows]
"Money Heist" = 71446      # TMDB TV id (from the show's themoviedb.org URL)
[movies]
"Some Title" = 0           # 0 = don't match
```

What the Netflix pages add:
- **Shows** page: how far you got into each show (episodes and seasons, against TMDB's episode list), marked *Finished* (watched up to the latest episode), *Watching* (watched in the last 30 days) or *Dropped*; your fastest seasons; rewatches; your movies.
- **Home** shows episodes vs movies and your show progress; **Top** has a Movies tab; **Records** has your fastest season.
- **Wrapped** has its own Netflix story (posters, Top 5, fastest binge, finished vs dropped, shows vs movies) and its own personalities in `personalities-netflix.toml`, edited the same way as YouTube's `personalities.toml`.

Notes on the data:
- The quick download has dates only: watch time comes from TMDB runtimes (or `fallback_episode_minutes` / `fallback_movie_minutes` in `config.toml`), and the watch clock, heatmap and night/morning records stay hidden until you add the full export.
- The quick download lists each title once per account, so rewatches only show up across accounts or with the full export.
- Some anime and reality titles name a season after its arc ("One Piece: East Blue"). When that name has no TMDB match but the shorter one does, it's folded into the show with the arc as the season.
- Netflix sometimes writes an episode without its show (": Episode 5"). Those count in your totals as **Unknown show** but are left out of show rankings and progress.

*This product uses the TMDB API but is not endorsed or certified by TMDB.*

## Spotify

1. Request your **Extended streaming history**: spotify.com → Account → *Privacy settings* → *Download your data* → check **Extended streaming history** (lifetime, every play; takes up to 30 days). The quicker *Account data* download (about the last year, no albums or skips) works too, and both can be added together.
2. Add the `.zip` Spotify emails you on the **Data sources** page, or put the `Streaming_History_Audio_*.json` files in `data/spotify/`, then run:
   ```bash
   python backend/cli.py ingest --platform spotify
   ```
3. Pictures and genres (optional): `python backend/cli.py enrich --platform spotify`, or **Enrich** on the Data sources page.
   - **Album art** comes from Spotify's public embed endpoint and **artist photos** from Deezer's public search: no keys.
   - **Genres** come from Last.fm listeners' tags: get a free API key at [last.fm/api/account/create](https://www.last.fm/api/account/create) and save it with `python backend/cli.py secrets set LASTFM_API_KEY`.
   - It looks up your most-played albums and artists first (a minute or two), rebuilds the pages, then fills in the rest. Answers are cached, so a stopped run picks up where it left off.

Notes on the data:
- A **stream** is a play of 30 seconds or more (Spotify's own rule; stats.fm counts the same way). Shorter plays are counted per song as skips.
- Only what the stats use is kept: never your IP address, country or username. Podcasts, audiobooks and video plays are skipped.
- Spotify's developer API isn't used: new apps may only make a few hundred requests a day and get no genres.
- Wrapped has its own music story and listener personalities in `personalities-spotify.toml`.

## Steam

1. Get a free **Steam Web API key** at [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey) (any domain name, e.g. `localhost`; Steam asks you to approve it in the Steam app under Steam Guard → Confirmations), then save it and your profile link:
   ```bash
   python backend/cli.py secrets set STEAM_API_KEY
   python backend/cli.py secrets set STEAM_PROFILE     # steamcommunity.com/id/... or /profiles/...
   ```
2. In Steam: *Profile → Edit Profile → Privacy settings → Game details: Public* (Steam only shares playtime from public game details).
3. Run `python backend/cli.py fetch --platform steam`, or **Fetch** on the Data sources page. After that it checks hourly on its own while the app is running.

What's real and what isn't known: Steam only gives lifetime hours per game, never when you played. So nothing is guessed:
- **Lifetime hours** per game are exact, and count in the all-time totals and top games.
- **Your past** is told by your **achievement unlocks**, which are real, timestamped moments of play. They drive the calendar, the hours of the day you play, each year's most active game, records (rarest unlock, latest night…) and Wrapped.
- **Hours by day** start when the app starts tracking: it checks your library hourly while it runs, and the growth from one day's last check to the next day's is that day's play. If the app wasn't running for a few days, that growth can't be pinned to a day, so it counts in lifetime totals only.

What's stored: per game its name, minutes and last-played time; per achievement its name, description, unlock time and rarity; genres from the Steam store. Nothing about friends or your profile. Wrapped has its own games story and player personalities in `personalities-steam.toml`.

## Epic Games

Epic has no public API or export for playtime, so this reads your own data from the Epic Games Launcher's endpoints, the way the open-source launchers Legendary, Heroic and Playnite do. It's **unofficial** (Epic could change it) and **read-only**: nothing is ever written to your account.

1. Sign in at [epicgames.com](https://www.epicgames.com) in your browser, then open [this page](https://www.epicgames.com/id/api/redirect?clientId=34a02cf8f4414e29b15921876da36f9a&responseType=code). It shows a short JSON answer; copy the `authorizationCode` value (or the whole thing).
2. Save it, then fetch within a few minutes (the code works once):
   ```bash
   python backend/cli.py secrets set EPIC_AUTH_CODE
   python backend/cli.py fetch --platform epic
   ```
3. That's it: the fetch trades the code for a sign-in kept in your OS keychain (`EPIC_REFRESH_TOKEN`) and deletes the code. It checks hourly on its own while the app runs, which keeps the sign-in alive. If it ever expires, repeat steps 1–2.

It works like Steam: lifetime hours are exact, your past is told by achievement unlocks, and hours by day start when tracking begins. Epic also says when you got each game. Games without achievements (Fortnite, GTA V) count in lifetime hours and top games, never on invented dates.

What's stored: per game its name, minutes, cover art and store link; per achievement its name, description, unlock time and rarity. Nothing about friends, purchases or your account. Wrapped uses `personalities-epic.toml`.

## Crunchyroll

> **Unofficial.** Crunchyroll has no "download your data" option, so the app reads your watch history the same way crunchyroll.com shows it to you: from Crunchyroll's own (private) web API, signed in with your browser cookie. It only reads **your own** history, one request a second. It can stop working whenever Crunchyroll changes its site, and it isn't affiliated with or endorsed by Crunchyroll.

1. Log in at crunchyroll.com **on your profile** (accounts can have several profiles; the history you get is the one the browser is on).
2. Open DevTools (F12) → **Application** → **Cookies** → `https://www.crunchyroll.com`, and copy the value of **`etp_rt`**.
3. Save it (treat it like a password; it's kept in your OS keychain and never leaves your machine):
   ```bash
   python backend/cli.py secrets set CRUNCHYROLL_ETP_RT
   ```
4. In `config.toml`, set your profile name so a cookie from someone else's profile is refused:
   ```toml
   [crunchyroll]
   profile = "Ethan"
   ```
5. Run:
   ```bash
   python backend/cli.py fetch --platform crunchyroll    # history -> data/crunchyroll/watch-history.json
   python backend/cli.py enrich --platform crunchyroll   # posters + episode lists (Crunchyroll) and studios / seasons (AniList)
   ```
   If the cookie has expired (you logged out), copy a fresh `etp_rt`. Re-run both commands any time for new episodes.

What you get: real watch time (how far into each episode you got) and real times of day, show progress against every episode out, the **Anime** tab (sub vs dub, simulcast watching, studios, the season each series aired, AniList scores and tags), series pages with an episode checklist, and a Crunchyroll Wrapped story with anime personalities (`personalities-crunchyroll.toml`).

Notes on the data:
- Crunchyroll keeps only your **latest** play of each episode, so rewatches aren't visible.
- Subbed and dubbed versions of an episode are different videos on Crunchyroll; progress counts each episode once.
- Plays under 30 seconds and videos that have since been removed are skipped.
- Studios, seasons, scores and tags come from [AniList](https://anilist.co) (free, no key), matched by title. Fix a wrong match in `data/crunchyroll/overrides.toml`:
  ```toml
  [anilist]
  "Some Title" = 12345   # AniList id from anilist.co/anime/<id>; 0 = don't match
  ```

## How platforms are organized

- Every platform is a **connector**: a package in `backend/ytw/connectors/<id>/` with a manifest (wording like "channel/video" vs "show/episode", features such as Shorts or estimated time, theme, image hosts, secrets, how to export the data) and the steps `ingest`, `build`, plus `enrich` / `fetch` where the platform has them. They're found automatically; planned platforms are listed in `connectors/planned.py`.
- Each platform has its own raw-export folder (`data/<platform>/`) and its own database (`data/<platform>.db`). Connectors write typed rows (`View`, `Item`, `Creator` in `connectors/store.py`) into the generic `watches`, `items` and `creators` tables that every stat reads.
- New platform: `python scripts/new_connector.py <id> "<Name>"`, then see [CONTRIBUTING.md](CONTRIBUTING.md#adding-a-platform).
- The API takes `?platform=<id>` (default `youtube`); the CLI takes `--platform <id>`.
- Themes are CSS variables in `frontend/src/index.css` (`[data-theme="youtube"]`, …).

## Secrets

API keys, tokens and cookies are kept in your OS keychain (Windows Credential Manager, macOS Keychain or the Linux Secret Service), never in plain text in the repo.

```bash
python backend/cli.py secrets list               # names and where each is set (never the values)
python backend/cli.py secrets set TMDB_TOKEN     # paste at a hidden prompt
python backend/cli.py secrets delete TMDB_TOKEN
python backend/cli.py secrets migrate            # move secrets from an old .env into the keychain
```

An environment variable (or a line in `.env`) with the same name still overrides the keychain, e.g. for a one-off run. On a system with no keychain, secrets go to `data/.secrets.json` (readable only by you) with a warning. Known secret values, `Authorization` headers, cookies and `key=`/`token=` parameters are masked in every log line.

## Configuration

`config.toml` holds your timezone (default `America/New_York`), watch-time estimation settings, Shorts detection, tag filtering and the background/sleep-audio keyword list. After editing it, run `python backend/cli.py build` (or `ingest` if you changed the timezone) and restart `run.py`.

## How the data is interpreted

- **Ads** are detected only by Takeout's "From Google Ads" marker (titles can't be trusted). They're excluded from all stats except a separate ads section.
- **Unavailable videos** (removed/private, with no channel in Takeout) still count as watches. Enrichment tries them once in case they're only unlisted.
- **Watch time is estimated.** Takeout only records when a video *started*. The estimate uses the gap until the next video, capped by the video's length, and the UI always labels it as an estimate.

## Tests

```bash
python -m pytest
python scripts/crosscheck.py   # compares database totals against the raw JSON
```

Dependencies are locked with hashes (`requirements.txt`, `frontend/package-lock.json`). CI runs the tests, the frontend build, ruff, bandit, gitleaks, CodeQL and dependency audits on every push; see [CONTRIBUTING.md](CONTRIBUTING.md).
