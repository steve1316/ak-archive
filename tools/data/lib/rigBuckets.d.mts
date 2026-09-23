/** Types for `rigBuckets.mjs`, so `vite.config.ts` and `src/lib/spine.ts` can import it under the app's strict typecheck. */

/** How many buckets each rig index is split into. See `rigBuckets.mjs`. */
export declare const RIG_BUCKET_COUNT: number;

/** The bucket an operator or enemy id belongs to. See `rigBuckets.mjs`. */
export declare function rigBucket(id: string): number;

/** Split a rig index into its buckets. See `rigBuckets.mjs`. */
export declare function splitRigIndex<T>(index: Record<string, T>): Record<string, T>[];
