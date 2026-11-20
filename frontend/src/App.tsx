import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { PageTitle } from "./components/ui";
import { Home } from "./pages/Home";
import { Top } from "./pages/Top";
import { Patterns } from "./pages/Patterns";
import { Records } from "./pages/Records";
import { Ads } from "./pages/Ads";
import { Evolution } from "./pages/Evolution";
import { CategoryPage, ChannelPage, GenrePage, VideoPage, YearPage } from "./pages/Details";
import { Search } from "./pages/Search";
import { WrappedPage } from "./wrapped/Wrapped";

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
      <Routes>
        <Route path="/" element={<Layout><Home /></Layout>} />
        <Route path="/top/:kind" element={<Layout><Top /></Layout>} />
        <Route path="/patterns" element={<Layout><Patterns /></Layout>} />
        <Route path="/records" element={<Layout><Records /></Layout>} />
        <Route path="/evolution" element={<Layout><Evolution /></Layout>} />
        <Route path="/ads" element={<Layout><Ads /></Layout>} />
        <Route path="/search" element={<Layout><Search /></Layout>} />
        <Route path="/channel/:id" element={<Layout><ChannelPage /></Layout>} />
        <Route path="/video/:id" element={<Layout showRange={false}><VideoPage /></Layout>} />
        <Route path="/category/:id" element={<Layout><CategoryPage /></Layout>} />
        <Route path="/genre/:topic" element={<Layout><GenrePage /></Layout>} />
        <Route path="/year/:year" element={<Layout showRange={false}><YearPage /></Layout>} />
        <Route path="/wrapped" element={<WrappedPage />} />
        <Route path="*" element={<Layout><PageTitle title="Not found" /></Layout>} />
      </Routes>
    </>
  );
}
