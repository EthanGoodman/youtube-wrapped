# YouTube Wrapped

A local, private stats dashboard for your YouTube watch history (think stats.fm, but for YouTube), built from a Google Takeout export. Everything runs on your machine. The only thing that leaves it is video/channel ID lookups to the YouTube Data API.

> Status: data pipeline (ingest + API enrichment) is done. Stats engine, dashboard and Wrapped story mode are in progress.

## Setup

Requires Python 3.11+ (and Node 20+ once the frontend lands).

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
5. Copy these from `Takeout/YouTube and YouTube Music/history/` into this repo's `data/` folder:
   - `watch-history.json` (required)
   - `search-history.json` (optional, enables search stats)

`data/` is gitignored, so your history is never committed.

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
python backend/cli.py ingest   # parse Takeout into data/wrapped.db (~5s for 90k entries)
python backend/cli.py enrich   # fetch video/channel details from the API
```

- **Re-running is safe.** `ingest` skips entries it already has, so you can import a newer Takeout on top. `enrich` caches every result and never looks up the same ID twice.
- **Resumable.** If `enrich` stops (quota, Ctrl+C, network), run it again and it continues where it left off. Quota resets at midnight Pacific time.
- Useful flags: `enrich --budget 500` (cap units used today), `--skip-ads` (don't look up ad videos), `--retry-missing` (re-ask for videos the API didn't return before).

## Configuration

`config.toml` holds your timezone (default `America/New_York`), watch-time estimation settings, Shorts detection and the background/sleep-audio keyword list. If you change the timezone, rerun `ingest` and it will rebuild.

## How the data is interpreted

- **Ads** are detected only by Takeout's "From Google Ads" marker (titles can't be trusted). They're excluded from all stats except a separate ads section.
- **Unavailable videos** (removed/private, with no channel in Takeout) still count as watches. Enrichment tries them once in case they're only unlisted.
- **Watch time is estimated.** Takeout only records when a video *started*. The estimate uses the gap until the next video, capped by the video's length, and the UI always labels it as an estimate.

## Tests

```bash
python -m pytest
python scripts/crosscheck.py   # compares database totals against the raw JSON
```
