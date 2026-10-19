/**
 * Where the site is served. Today that's GitHub Pages under /decant/; a custom
 * domain serves it from the root instead. Override with BASE_PATH and SITE_URL.
 */
export const BASE_PATH = process.env.BASE_PATH ?? '/decant/';
export const SITE_URL = process.env.SITE_URL ?? `https://joshuafitzmorris.github.io${BASE_PATH}`;
