import { lazy, useMemo } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import Shell, { PageFallback } from './components/Shell';
import { ErrorBox } from './components/ui';
import { AppDataContext, useMeta, useUniverse } from './lib/hooks';

// Pages are lazy-loaded, so the first load only ships the shell and the page being viewed.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Screener = lazy(() => import('./pages/Screener'));
const Stock = lazy(() => import('./pages/Stock'));
const Learn = lazy(() => import('./pages/Learn'));
const Compare = lazy(() => import('./pages/Compare'));
const Heatmap = lazy(() => import('./pages/Heatmap'));
const Stats = lazy(() => import('./pages/Stats'));
const Placeholder = lazy(() => import('./pages/Placeholder'));
const Watchlist = lazy(() => import('./pages/Watchlist'));

function Loaded() {
  const meta = useMeta();
  const universe = useUniverse();
  const value = useMemo(
    () =>
      meta.data && universe.data
        ? { meta: meta.data, universe: universe.data, bySym: new Map(universe.data.map((u) => [u.sym, u])) }
        : null,
    [meta.data, universe.data],
  );
  if (meta.error || universe.error) {
    return (
      <div className="p-4">
        <ErrorBox message={(meta.error ?? universe.error) as string} />
      </div>
    );
  }
  if (!value) return <PageFallback />;
  return (
    <AppDataContext.Provider value={value}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="screener" element={<Screener />} />
          <Route path="stock/:sym" element={<Stock />} />
          <Route path="learn" element={<Learn />} />
          <Route path="watchlist" element={<Watchlist />} />
          <Route path="compare" element={<Compare />} />
          <Route path="heatmap" element={<Heatmap />} />
          <Route path="institutions" element={<Placeholder title="Institutions" />} />
          <Route path="deals" element={<Placeholder title="Deals" />} />
          <Route path="entity/:id" element={<Placeholder title="Entity" />} />
          <Route path="stats" element={<Stats />} />
          <Route path="*" element={<Placeholder title="Page not found" />} />
        </Route>
      </Routes>
    </AppDataContext.Provider>
  );
}

export default function App() {
  return (
    <HashRouter>
      <Loaded />
    </HashRouter>
  );
}
