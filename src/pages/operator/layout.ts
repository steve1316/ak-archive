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

/** A section card's heading. Never grows, so it cannot push the card's flexible child out of the box. */
export const SECTION_HEADING_SX: SxProps<Theme> = { mb: 1.125, flex: "none" };
