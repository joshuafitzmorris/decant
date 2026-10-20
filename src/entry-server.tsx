import { renderToString } from 'react-dom/server';
import { App } from './app/App';
import type { Route } from './core/seo';

/** Renders a page to HTML at build time, so it has real content before any JavaScript runs. */
export function render(route: Route): string {
  return renderToString(<App route={route} />);
}
