// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Operator page layout

/** Geometry shared by the operator page's sections, so the cards read as one surface over the backdrop. */

import { alpha } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

/**
 * Height of the kit's navbar. `ArchiveNavbar` is a fixed AppBar over an empty `Toolbar` spacer, and a `Toolbar` takes MUI's toolbar mixin,
 * which is 64px from the `sm` breakpoint up. The fold is measured from under it.
 */
export const NAVBAR_HEIGHT = 64;

/**
 * A section card: translucent so the backdrop reads through, and a flex column so a child can take the remaining height with `flex: 1`.
 *
 * Deliberately not `height: 100%` on children. A child below the card's heading at 100% resolves to the whole content box, so the card
 * overflows by exactly the heading's height - the bug measured during design.
 */
export const SECTION_SX: SxProps<Theme> = (theme) => ({
	p: 1.875,
	backgroundColor: alpha(theme.palette.background.paper, 0.72),
	backdropFilter: "blur(6px)",
	display: "flex",
	flexDirection: "column",
	minHeight: 0
});

/** The gap under a section card's heading, shared with any control row that sits directly beneath one, such as the Animations card's switch. */
export const SECTION_HEADING_GAP = 1.125;

/** A section card's heading. Never grows, so it cannot push the card's flexible child out of the box. */
export const SECTION_HEADING_SX: SxProps<Theme> = { mb: SECTION_HEADING_GAP, flex: "none" };

/** The tight corner radius the art card and the identity badge/chips share, smaller than the theme's default `borderRadius: 1`. */
export const TIGHT_RADIUS = "3px";

/** The tab strip base: bottom border and un-uppercased, semi-bold tab labels, shared by every operator-page tab strip. */
export const TAB_STRIP_SX = {
	borderBottom: 1,
	borderColor: "divider",
	"& .MuiTab-root": { textTransform: "none", fontWeight: 600 }
} as const satisfies SxProps<Theme>;

/**
 * The raised-surface fill used for badges, chips and tiles that sit a shade lighter than the section card behind them. `raised` is optional on
 * MUI's augmented `Palette`, hence the fallback. Usable directly as an `sx` property value, or called with a theme already in scope.
 *
 * @param theme The active theme.
 * @returns The raised background colour.
 */
export const RAISED_BG = (theme: Theme): string => theme.palette.raised ?? theme.palette.background.paper;

/** A raised tile's border, corner radius and fill, shared by every card or tile that sits on the kit's raised surface. */
export const RAISED_TILE_SX: SxProps<Theme> = {
	border: 1,
	borderColor: "divider",
	borderRadius: 1,
	backgroundColor: RAISED_BG
};
