/** Types for `routePages.mjs`, so `vite.config.ts` and `src/lib/routes.ts` can import it under the app's strict typecheck. */

/** The short number an operator's URL uses. See `routePages.mjs`. */
export declare function operatorNumber(id: string): string;

/** The short number an enemy group's URL uses. See `routePages.mjs`. */
export declare function enemyNumber(id: string): string;

/** Every route a reader can land on directly, relative to the base. See `routePages.mjs`. */
export declare function routePagePaths(ids: { operatorIds: string[]; enemyHeadIds: string[] }): string[];
