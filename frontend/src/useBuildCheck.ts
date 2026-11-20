/* Reload an open tab that is still running an older frontend build.

   A single-page app never re-downloads its code while you click around, so a tab opened before
   a rebuild keeps showing the old pages (e.g. Netflix pages without the Netflix look). The server
   reports the build it currently hands out; when that differs from the one this tab runs, reload. */
import { useEffect } from "react";

const CHECK_EVERY_MS = 60_000;

function currentBuild(): string | null {
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  return s ? new URL(s.src, location.href).pathname : null;  // null in dev (Vite serves /src/main.tsx)
}

export function useBuildCheck() {
  useEffect(() => {
    const mine = currentBuild();
    if (!mine) return;
    let stopped = false;
    const check = async () => {
      try {
        const r = await fetch("/api/build", { cache: "no-store" });
        const { build } = (await r.json()) as { build: string | null };
        if (stopped || !build || build === mine) return;
        // one reload per new build, so a broken deploy can't cause a reload loop
        const key = `reloaded-for:${build}`;
        try {
          if (sessionStorage.getItem(key)) return;
          sessionStorage.setItem(key, "1");
        } catch { /* storage blocked: still reload once */ }
        location.reload();
      } catch { /* server down: try again later */ }
    };
    const onVisible = () => document.visibilityState === "visible" && check();
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    check();
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, []);
}
