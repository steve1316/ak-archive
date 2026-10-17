/** Types for `routePages.mjs`, so `vite.config.ts` and `src/lib/routes.ts` can import it under the app's strict typecheck. */

/** The short number an operator's URL uses. See `routePages.mjs`. */
export declare function operatorNumber(id: string): string;

/** The short number an enemy group's URL uses. See `routePages.mjs`. */
export declare function enemyNumber(id: string): string;

/** The parts of a story group a story's URL is built from. */
export interface StoryGroupIds {
	/** The group id. */
	id: string;
	/** Its stories, in order. */
	stories: { id: string }[];
}

/** The short name a story's URL ends in, or an empty string for a group's only story. See `routePages.mjs`. */
export declare function storySlug(group: StoryGroupIds, story: string): string;

/** A story's route under the site's base, without a leading slash. See `routePages.mjs`. */
export declare function storyRoute(group: StoryGroupIds, story: string): string;

/** Every route a reader can land on directly, relative to the base. See `routePages.mjs`. */
export declare function routePagePaths(ids: { operatorIds: string[]; enemyHeadIds: string[]; storyGroups?: StoryGroupIds[] }): string[];
