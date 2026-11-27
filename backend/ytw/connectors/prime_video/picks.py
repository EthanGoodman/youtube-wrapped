"""A checklist page for another profile's watch history: tick the shows and movies you watched there.
"Save my picks" downloads prime-picks-<profile>.json, which goes in data/prime_video/ next to the history.
The page is a local file and makes no requests."""
from __future__ import annotations

import html
import json
from datetime import datetime, timezone

from .ingest import fingerprint, split_show


def page(items: list[dict], label: str) -> str:
    groups: dict[tuple[bool, str], dict] = {}
    for x in items:
        movie = x.get("type") == "Movie"
        title = x.get("title") or ""
        name = title if movie else split_show(title)[0]
        g = groups.setdefault((movie, name), {"titles": set(), "n": 0, "first": float("inf"), "last": 0})
        g["titles"].add(x.get("title") or "")
        g["n"] += 0 if movie else 1
        at = float(x.get("watchedAt") or 0)
        g["first"], g["last"] = min(g["first"], at), max(g["last"], at)
    yr = lambda ms: datetime.fromtimestamp(ms / 1000, timezone.utc).year
    rows = sorted(groups.items(), key=lambda kv: (-kv[1]["last"], kv[0][1].lower()))
    data = [{"name": name, "movie": movie, "titles": sorted(g["titles"]), "n": g["n"],
             "span": str(yr(g["first"])) if yr(g["first"]) == yr(g["last"]) else f"{yr(g['first'])}–{yr(g['last'])}"}
            for (movie, name), g in rows]
    # </script> can't appear inside the inline data
    js = lambda v: json.dumps(v).replace("</", "<\\/")
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Which did you watch?</title>
<style>
 :root{{--bg:#F4EEE3;--ink:#1C1915;--soft:#6B6358;--mustard:#E2A93B;--line:#E0D5C1;--paper:#FBF6EC}}
 body{{margin:0;background:var(--bg);color:var(--ink);font:16px/1.4 system-ui,sans-serif}}
 header{{position:sticky;top:0;background:var(--ink);color:var(--paper);padding:14px 16px;display:flex;flex-wrap:wrap;gap:12px;align-items:center;z-index:2}}
 header h1{{font-size:20px;margin:0;flex:1 1 240px}} header .count{{font-family:ui-monospace,monospace;font-size:13px}}
 button{{font:inherit;font-weight:700;border:2px solid var(--paper);background:var(--mustard);color:var(--ink);border-radius:10px;padding:8px 14px;cursor:pointer}}
 button.ghost{{background:transparent;color:var(--paper)}}
 main{{max-width:900px;margin:0 auto;padding:16px 16px 80px}}
 input[type=search]{{width:100%;box-sizing:border-box;font:inherit;padding:10px 12px;border:2px solid var(--ink);border-radius:10px;margin:8px 0 14px;background:var(--paper)}}
 label.row{{display:flex;gap:12px;align-items:center;padding:10px 6px;border-bottom:1px solid var(--line);cursor:pointer}}
 label.row:hover{{background:rgba(0,0,0,.03)}} label.row input{{width:22px;height:22px;accent-color:#2E6B63;flex:none}}
 .name{{font-weight:700}} .meta{{font-family:ui-monospace,monospace;font-size:12px;color:var(--soft)}}
 .tag{{font-size:11px;font-family:ui-monospace,monospace;border:1px solid var(--ink);border-radius:99px;padding:1px 7px;margin-left:6px}}
</style></head><body>
<header><h1>Which of these did <u>you</u> watch? <span class="count" id="count"></span></h1>
 <button class="ghost" id="none" type="button">Clear all</button><button id="save" type="button">Save my picks</button></header>
<main><p class="meta">Profile: {html.escape(label)} · {len(data)} shows and movies, newest first. Every episode listed for a show you tick counts as yours.</p>
<input type="search" id="q" placeholder="Filter by name…" aria-label="Filter by name">
<div id="list"></div></main>
<script>
const DATA = {js(data)}, LABEL = {js(label)}, OF = {js(fingerprint(items))};
const list = document.getElementById("list"), count = document.getElementById("count");
DATA.forEach((d, i) => {{
  const row = document.createElement("label"); row.className = "row"; row.dataset.name = d.name.toLowerCase();
  const cb = document.createElement("input"); cb.type = "checkbox"; cb.dataset.i = i;
  const t = document.createElement("span"), name = document.createElement("span"), tag = document.createElement("span"),
        meta = document.createElement("span");
  name.className = "name"; name.textContent = d.name;
  tag.className = "tag"; tag.textContent = d.movie ? "movie" : d.n + " ep";
  meta.className = "meta"; meta.textContent = d.span;
  t.append(name, tag, document.createElement("br"), meta);
  row.append(cb, t); list.append(row);
}});
const upd = () => count.textContent = `${{document.querySelectorAll("#list input:checked").length}} ticked`;
list.addEventListener("change", upd); upd();
document.getElementById("q").addEventListener("input", (e) => {{
  const q = e.target.value.toLowerCase();
  document.querySelectorAll("label.row").forEach((r) => r.style.display = r.dataset.name.includes(q) ? "" : "none");
}});
document.getElementById("none").onclick = () => {{ document.querySelectorAll("#list input").forEach((c) => c.checked = false); upd(); }};
document.getElementById("save").onclick = () => {{
  const picks = [...document.querySelectorAll("#list input:checked")].flatMap((c) => DATA[+c.dataset.i].titles);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify({{profile: LABEL, of: OF, picks}}, null, 1)], {{type: "application/json"}}));
  a.download = `prime-picks-${{LABEL.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}}.json`; a.click();
}};
</script></body></html>"""
