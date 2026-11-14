import { AppLink } from '../components/ui';

/** Routes from the spec that belong to later phases (compare, heatmap, institutions, deals, stats). */
export default function Placeholder({ title }: { title: string }) {
  return (
    <div className="card mx-auto max-w-md space-y-2 p-6 text-center">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        This page is planned for a later phase and is not built yet.
      </p>
      <AppLink to="/" className="text-sm text-blue-700 hover:underline dark:text-blue-300">
        Back to the dashboard
      </AppLink>
    </div>
  );
}
