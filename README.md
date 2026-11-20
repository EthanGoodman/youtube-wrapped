# YouTube Wrapped

A local, private stats dashboard and year-in-review ("Wrapped") for the apps you use, built from each app's own data export (think stats.fm, but for everything). Everything runs on your machine. The only things that leave it are metadata lookups (e.g. video/channel IDs to the YouTube Data API).

## Platforms

| Platform | Status |
|---|---|
| YouTube | ✅ Supported |
| Netflix | In progress ([#2](https://github.com/EthanGoodman/youtube-wrapped/issues/2)) - import + TMDB enrichment work |
| Spotify | Planned ([#3](https://github.com/EthanGoodman/youtube-wrapped/issues/3)) |
| Prime Video | Planned ([#4](https://github.com/EthanGoodman/youtube-wrapped/issues/4)) |
| TikTok | Planned ([#5](https://github.com/EthanGoodman/youtube-wrapped/issues/5)) |
| Instagram | Planned ([#6](https://github.com/EthanGoodman/youtube-wrapped/issues/6)) |
| Crunchyroll | Planned ([#7](https://github.com/EthanGoodman/youtube-wrapped/issues/7)) |

Each platform keeps the same layout (stats.fm-style top lists, clock, records, evolution and a Wrapped story) but is styled like the service itself. The steps below cover YouTube.


## Setup

Requires Python 3.11+ and Node.js 20+.

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
```

## 1. Get your Takeout data

1. Go to [takeout.google.com](https://takeout.google.com), click **Deselect all**, then select **YouTube and YouTube Music**.
2. Click **All YouTube data included**, deselect everything except **history**.
3. Click **Multiple formats** and set **History** to **JSON**.
4. Export, download, unzip.
5. Copy these from `Takeout/YouTube and YouTube Music/history/` into this repo's `data/youtube/` folder:
   - `watch-history.json` (required)
   - `search-history.json` (optional, enables search stats)

`data/` is gitignored, so your history is never committed. Each platform has its own folder (`data/youtube/`, …) and its own processed database (`data/youtube.db`), which can always be rebuilt from the exports. If you used an older version that kept files directly in `data/`, they're moved automatically on the next run.

## 2. Get a YouTube Data API key (free, optional)

Without a key the app still works, but with no durations, categories, genres or thumbnails, and with rougher watch-time estimates.

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create a project (any name).
2. Go to **APIs & Services → Library**, search for **YouTube Data API v3**, and click **Enable**.
3. Go to **APIs & Services → Credentials → Create credentials → API key**.
4. Optional but recommended: click the key, and under **API restrictions** restrict it to *YouTube Data API v3*.
5. Create a `.env` file in the repo root:

   ```
   YOUTUBE_API_KEY=your-key-here
   ```

`.env` is gitignored. The free quota is 10,000 units/day. Lookups are batched 50 IDs per unit, so even a very large history (~80k videos) takes about 2,000 units.

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

**Developing the frontend:** run `python run.py --no-browser` in one terminal and `npm run dev` in `frontend/` in another, then open http://localhost:5173 (hot reload; API calls are forwarded to port 8000).

## Netflix

1. Get your history, either or both:
   - **Quick (instant):** netflix.com/viewingactivity → *Download all* → `NetflixViewingHistory.csv`. Titles and dates only, so watch time is estimated and there are no times of day.
   - **Full (takes a few days):** netflix.com/account → *Download your personal information* → `CONTENT_INTERACTION/ViewingActivity.csv`. Adds exact start times and durations. If it has several profiles, set `[netflix] profile = "Your Name"` in `config.toml` (or pass `--profile`).
2. Put the file in `data/netflix/` (the full export wins if both are there).
3. Get a free TMDB token for posters, genres and runtimes: sign up at [themoviedb.org](https://www.themoviedb.org) → Settings → API → create a *Developer* key, then add the **API Read Access Token** to `.env`:
   ```
   TMDB_TOKEN=eyJ...
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

*This product uses the TMDB API but is not endorsed or certified by TMDB.*

## How platforms are organized

- `backend/ytw/platforms.py` describes every platform: its wording ("channel/video" vs "show/episode" vs "artist/track"), which features it has (Shorts, ads, search history, estimated vs exact time), its theme and how to export its data.
- Each platform has its own raw-export folder (`data/<platform>/`) and its own database (`data/<platform>.db`). The stats engine reads the generic `watches`, `items` and `creators` tables, which every platform fills in its own way.
- The API takes `?platform=<id>` (default `youtube`); the CLI takes `--platform <id>`.
- Themes are CSS variables in `frontend/src/index.css` (`[data-theme="youtube"]`, …).

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
