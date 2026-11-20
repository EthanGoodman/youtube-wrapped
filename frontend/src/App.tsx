import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { PageTitle } from "./components/ui";
import { Home } from "./pages/Home";
import { Top } from "./pages/Top";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo(0, 0), [pathname]);
  return null;
}

function Placeholder({ title }: { title: string }) {
  return <PageTitle title={title} subtitle="Coming in the next step." />;
}

export function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Layout><Home /></Layout>} />
        <Route path="/top/:kind" element={<Layout><Top /></Layout>} />
        <Route path="/patterns" element={<Layout><Placeholder title="Patterns" /></Layout>} />
        <Route path="/records" element={<Layout><Placeholder title="Records" /></Layout>} />
        <Route path="/evolution" element={<Layout><Placeholder title="Evolution" /></Layout>} />
        <Route path="/ads" element={<Layout><Placeholder title="Ads" /></Layout>} />
        <Route path="/search" element={<Layout><Placeholder title="Search" /></Layout>} />
        <Route path="/channel/:id" element={<Layout><Placeholder title="Channel" /></Layout>} />
        <Route path="/video/:id" element={<Layout showRange={false}><Placeholder title="Video" /></Layout>} />
        <Route path="/category/:id" element={<Layout><Placeholder title="Category" /></Layout>} />
        <Route path="/genre/:topic" element={<Layout><Placeholder title="Genre" /></Layout>} />
        <Route path="/year/:year" element={<Layout showRange={false}><Placeholder title="Year" /></Layout>} />
        <Route path="/wrapped" element={<Layout showRange={false}><Placeholder title="Wrapped (Phase 5)" /></Layout>} />
        <Route path="*" element={<Layout><PageTitle title="Not found" /></Layout>} />
      </Routes>
    </>
  );
}
