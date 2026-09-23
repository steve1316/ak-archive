/** Types for `presence.mjs`, so `vite.config.ts` can import it under the app's strict typecheck. */

/** The slice of the asset manifest the browser reads. */
export interface AssetPresence {
	/** False when no manifest was built, in which case nothing counts as published. */
	available: boolean;
	/** Ids whose asset is not published, per flag section. Every other id the data names is published. */
	missing: { portraits: string[]; illustrations: string[]; enemies: string[] };
	/** Variant keys per art kind and operator, in each kind's own upstream spelling. */
	variants: { portraits?: Record<string, string[]>; illustrations?: Record<string, string[]> };
	/** Published module picture keys. */
	moduleArt: string[];
	/** Published branch badge keys. */
	moduleTypes: string[];
}

/** What the site sees when no manifest has been built. */
export declare const EMPTY_PRESENCE: AssetPresence;

/**
 * Reduce the asset manifest to what the browser reads.
 *
 * @param manifest The parsed `assets-manifest.json`.
 * @returns The slim presence data.
 */
export declare function slimManifest(manifest: Record<string, unknown>): AssetPresence;
