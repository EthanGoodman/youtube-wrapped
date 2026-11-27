// Save one Prime Video profile's watch history as a .json file (what that profile watched, and when).
// 1. Open primevideo.com/settings/watch-history on the profile, and don't scroll.
// 2. Press F12, open Console, paste all of this and press Enter.
// It scrolls the page to load everything, then downloads prime-watch-history.json. It sends nothing anywhere:
// it only reads the page and what the page itself loads while scrolling.
(async () => {
  const items = new Map();
  const add = (o) => {                          // any watch-history widget, wherever it sits in the data
    const seen = new Set(), stack = [o];
    while (stack.length) {
      const x = stack.pop();
      if (!x || typeof x !== "object" || seen.has(x)) continue;
      seen.add(x);
      if (x.widgetType === "watch-history") {
        for (const day of x?.content?.content?.titles ?? []) for (const t of day.titles ?? []) {
          const base = { title: t?.title?.text ?? "", id: t?.gti ?? "" };
          const eps = Array.isArray(t.children) && t.children.length ? t.children : [null];
          for (const e of eps) {
            const row = { ...base, type: e ? "Series" : "Movie", episodeTitle: e?.title?.text ?? "",
                          episodeId: e?.gti ?? "", watchedAt: e ? e.time : t.time };
            items.set(`${row.id}|${row.episodeId}|${row.watchedAt}`, row);
          }
        }
      }
      for (const v of Object.values(x)) if (v && typeof v === "object") stack.push(v);
    }
  };
  for (const s of document.querySelectorAll("script")) {      // the first batch, embedded in the page
    try { add(JSON.parse(s.textContent.trim())); } catch {}
  }
  console.log("first batch:", items.size);
  const orig = window.fetch;                                   // everything loaded while scrolling
  window.fetch = async (...a) => {
    const r = await orig(...a);
    r.clone().json().then(add).catch(() => {});
    return r;
  };
  await new Promise((done) => {
    const t = setInterval(() => {
      if (!document.querySelector("div[data-automation-id=activity-history-items] > div > noscript")) { clearInterval(t); done(); }
      window.scrollTo(0, document.body.scrollHeight);
    }, 150);
  });
  await new Promise((r) => setTimeout(r, 2000));
  window.fetch = orig;
  const out = [...items.values()].sort((a, b) => b.watchedAt - a.watchedAt);
  console.log("total items:", out.length);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: "application/json" }));
  a.download = "prime-watch-history.json";
  a.click();
})();
