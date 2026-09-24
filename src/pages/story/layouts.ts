// The player's three layouts, shared by the page, the stage and the Log. Desktop is the default. These two replace it where the game's
// in-stage text would be too small to read.

/**
 * A window taller than it is wide, such as a phone held upright, or one too narrow for the in-stage text to be readable. The line and the
 * choices move into a panel under the stage.
 */
export const STACKED_QUERY = "(max-aspect-ratio: 1/1), (max-width: 599.95px)";
export const STACKED = `@media ${STACKED_QUERY}`;

/** A phone on its side: too short for anything under the stage, so a readable text box lies across the stage's bottom instead. */
export const COMPACT_QUERY = "(min-aspect-ratio: 1001/1000) and (min-width: 600px) and (max-height: 500px)";
export const COMPACT = `@media ${COMPACT_QUERY}`;
