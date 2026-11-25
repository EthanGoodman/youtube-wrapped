import { useEffect } from "react";
import { useBuildCheck } from "./useBuildCheck";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { Layout } from "./components/Layout";
import { PageTitle } from "./components/ui";
import { Home } from "./pages/Home";
import { Hub } from "./pages/Hub";
import { Sources } from "./pages/Sources";
import { Anime } from "./families/shows/Anime";
import { Shows } from "./families/shows/Shows";
import { Top } from "./pages/Top";
import { Patterns } from "./pages/Patterns";
import { Records } from "./pages/Records";
import { Ads } from "./pages/Ads";
import { Evolution } from "./pages/Evolution";
import { CategoryPage, ChannelPage, GenrePage, VideoPage, YearPage } from "./pages/Details";
import { Search } from "./pages/Search";
import { WrappedPage } from "./wrapped/Wrapped";
import { OverviewPage } from "./overview/OverviewPage";
import { ShowsOverviewPage } from "./overview/ShowsOverviewPage";
import { HowFarPage } from "./overview/HowFarPage";
import { AnimePage } from "./overview/AnimePage";
import { ShowDetailPage } from "./overview/ShowDetailPage";
import { TopPage } from "./overview/TopPage";
import { PatternsPage } from "./overview/PatternsPage";
import { RecordsPage } from "./overview/RecordsPage";
import { EvolutionPage } from "./overview/EvolutionPage";
import { AdsPage, SearchPage } from "./overview/MorePages";
import { CategoryDetailPage, ChannelDetailPage, GenreDetailPage, VideoDetailPage, YearDetailPage } from "./overview/DetailPages";
import { usePlatforms } from "./api";
import { HubLink, PLATFORM_IDS, setVocab, useCapability } from "./platform";
import { setChartTheme } from "./theme";
import { applyThemeColors, themeOf } from "./themes";

/** Platforms on the new stats pages (the rest keep the old layout until they move over). */
const SHOWS_NEW = ["netflix", "crunchyroll"];
const NEW_LOOK = ["youtube", ...SHOWS_NEW];

/** Sections of a platform. Old single-platform links (/top/channels, …) redirect to /youtube/… */
const SECTIONS = ["top", "patterns", "records", "evolution", "ads", "search", "channel", "video", "category",
                  "genre", "year", "wrapped"];

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export function App() {
  return (
    <>
      <ScrollToTop />
      <BuildCheck />
      <Routes>
        <Route path="/" element={<HubPage />} />
        <Route path="/sources" element={<HubPage page={<Sources />} />} />
        <Route path="/:platform/*" element={<PlatformApp />} />
      </Routes>
    </>
  );
}

/** Pages outside any platform (hub, data sources): neutral theme. */
function HubPage({ page = <Hub /> }: { page?: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.removeAttribute("data-theme");
    applyThemeColors(null);
  }, []);
  return <>{page}</>;
}

/** Everything under /<platform>/: checks the platform, applies its theme, routes its pages. */
function PlatformApp() {
  const { platform = "" } = useParams();
  const { pathname, search } = useLocation();
  const platforms = usePlatforms().data;
  const info = platforms?.find((p) => p.id === platform);

  // apply the platform's theme before its pages render (CSS colors + chart colors)
  const theme = info?.theme ?? platform;
  if (PLATFORM_IDS.includes(platform)) {
    const t = info ? themeOf(info) : null;
    document.documentElement.setAttribute("data-theme", theme);
    applyThemeColors(t);
    setChartTheme(theme, t?.chart);
    setVocab(info?.vocab ?? null, info?.name);
  }

  if (!PLATFORM_IDS.includes(platform)) {
    if (!platforms) return null;  // a platform added on the server may not be known yet
    if (SECTIONS.includes(platform)) return <Navigate to={`/youtube${pathname}${search}`} replace />;
    return <NotFound />;
  }
  if (info && !info.implemented) return <NotSupported name={info.name} issue={info.issue} />;
  if (info && !info.has_data) return <Navigate to="/" replace />;

  return (
    <Routes>
      {/* YouTube is first on the new Overview (its own frame); the others keep their home until we generalize it */}
      <Route index element={platform === "youtube" ? <OverviewPage /> : SHOWS_NEW.includes(platform) ? <ShowsOverviewPage /> : <Layout><Home /></Layout>} />
      <Route path="top/:kind" element={NEW_LOOK.includes(platform) ? <TopPage /> : <Layout><Top /></Layout>} />
      <Route path="shows" element={<Gate capability="series">{SHOWS_NEW.includes(platform) ? <HowFarPage /> : <Layout><Shows /></Layout>}</Gate>} />
      <Route path="anime" element={<Gate capability="anime">{SHOWS_NEW.includes(platform) ? <AnimePage /> : <Layout><Anime /></Layout>}</Gate>} />
      <Route path="patterns" element={NEW_LOOK.includes(platform) ? <PatternsPage /> : <Layout><Patterns /></Layout>} />
      <Route path="records" element={NEW_LOOK.includes(platform) ? <RecordsPage /> : <Layout><Records /></Layout>} />
      <Route path="evolution" element={NEW_LOOK.includes(platform) ? <EvolutionPage /> : <Layout><Evolution /></Layout>} />
      <Route path="ads" element={<Gate capability="ads">{platform === "youtube" ? <AdsPage /> : <Layout><Ads /></Layout>}</Gate>} />
      <Route path="search" element={<Gate capability="search">{platform === "youtube" ? <SearchPage /> : <Layout><Search /></Layout>}</Gate>} />
      <Route path="channel/:id" element={SHOWS_NEW.includes(platform) ? <ShowDetailPage /> : platform === "youtube" ? <ChannelDetailPage /> : <Layout><ChannelPage /></Layout>} />
      <Route path="video/:id" element={platform === "youtube" ? <VideoDetailPage /> : <Layout showRange={false}><VideoPage /></Layout>} />
      <Route path="category/:id" element={platform === "youtube" ? <CategoryDetailPage /> : <Layout><CategoryPage /></Layout>} />
      <Route path="genre/:topic" element={platform === "youtube" ? <GenreDetailPage /> : <Layout><GenrePage /></Layout>} />
      <Route path="year/:year" element={platform === "youtube" ? <YearDetailPage /> : <Layout showRange={false}><YearPage /></Layout>} />
      <Route path="wrapped" element={<WrappedPage />} />
      <Route path="*" element={<Layout><PageTitle title="Not found" /></Layout>} />
    </Routes>
  );
}

/** Pages that only exist on platforms with that data (e.g. ads on YouTube). */
function Gate({ capability, children }: { capability: string; children: React.ReactNode }) {
  return useCapability(capability) ? <>{children}</> : <Navigate to=".." replace />;
}

function NotSupported({ name, issue }: { name: string; issue: number | null }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-black">{name} isn't supported yet</h1>
      {issue && (
        <a className="text-sub underline" href={`https://github.com/EthanGoodman/youtube-wrapped/issues/${issue}`}
           target="_blank" rel="noreferrer">Track it in issue #{issue}</a>
      )}
      <HubLink to="/" className="mt-2 rounded-full bg-raised px-4 py-2 text-sm font-medium">‹ All platforms</HubLink>
    </div>
  );
}

function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-black">Not found</h1>
      <HubLink to="/" className="rounded-full bg-raised px-4 py-2 text-sm font-medium">‹ All platforms</HubLink>
    </div>
  );
}

function BuildCheck() {
  useBuildCheck();
  return null;
}
