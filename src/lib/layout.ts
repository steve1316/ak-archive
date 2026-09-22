// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Detail page layout

/** Geometry shared by the operator and enemy pages' sections, so the cards read as one surface over the backdrop. */

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

/** A badge on the raised surface, such as the operator page's class icon beside the class name. */
export const BADGE_SX: SxProps<Theme> = {
	display: "inline-flex",
	alignItems: "center",
	gap: 0.875,
	px: 1.125,
	py: 0.375,
	border: 1,
	borderColor: "divider",
	borderRadius: TIGHT_RADIUS,
	backgroundColor: RAISED_BG,
	fontWeight: 600,
	fontSize: 13
};

/**
 * An unselected chip: the mockup's square-cornered outline on the same low-contrast fill as the rest of the fold's cards. Hover and focus lift
 * it to the raised-surface colour rather than MUI's default light overlay, which washes out white against a fill this dark.
 */
export const CHIP_UNSELECTED_SX: SxProps<Theme> = (theme) => ({
	border: "1px solid",
	borderColor: "divider",
	borderRadius: TIGHT_RADIUS,
	backgroundColor: "rgba(13, 14, 18, 0.55)",
	color: "text.secondary",
	fontWeight: 400,
	"&:hover, &.Mui-focusVisible": { backgroundColor: RAISED_BG(theme), borderColor: "text.secondary" }
});

/**
 * A selected chip: the primary fill and border in every state. A clickable MUI chip's own `:hover` and `.Mui-focusVisible` rules are more
 * specific than a plain `backgroundColor`, so hover and focus are pinned here explicitly rather than left to fall through to the default grey
 * overlay - the bug fix round 1 left behind.
 */
export const CHIP_SELECTED_SX: SxProps<Theme> = (theme) => ({
	border: "1px solid",
	borderColor: "primary.main",
	borderRadius: TIGHT_RADIUS,
	backgroundColor: "primary.main",
	color: theme.palette.primary.contrastText,
	fontWeight: 600,
	"&:hover, &.Mui-focusVisible": { backgroundColor: "primary.dark", borderColor: "primary.dark" }
});

/** A detail page's name heading. */
export const HERO_NAME_SX: SxProps<Theme> = { fontWeight: 700, lineHeight: 1.15, mt: 0.625 };

/** The small line beside the name, such as an operator's subclass and position. */
export const HERO_SUBTITLE_SX: SxProps<Theme> = { fontSize: 14, fontWeight: 400, color: "text.secondary", ml: 1.25 };

/** The "Global release" line under a hero name. */
export const HERO_RELEASE_SX: SxProps<Theme> = { mt: 0.5, fontSize: 13, color: "text.secondary" };

/** The row of choice chips under the name, such as an operator's forms or an enemy's variants. */
export const HERO_CHIPS_SX: SxProps<Theme> = { flexWrap: "wrap", gap: 0.625, mt: 1.25 };

/** A detail page's top padding, in the theme's spacing units. The operator page's fold subtracts it to size itself to the viewport. */
export const PAGE_TOP_PADDING = 1.75;

/** A detail page's body: above the fixed backdrop, with the locked design's 14px top and 20px side padding. */
export const PAGE_SX: SxProps<Theme> = { position: "relative", zIndex: 1, px: { xs: 2, md: 2.5 }, pt: PAGE_TOP_PADDING, pb: 3 };

/**
 * A detail page's first row: a 180px art or icon column, the identity and record beside it, and the 330px Animations card, so the operator and
 * enemy pages line up. Stacked on a narrow screen. A page that needs its own spacing around the row spreads this and adds it.
 */
export const HERO_ROW_SX = { display: "grid", gap: { xs: 2, md: 2.75 }, gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "180px minmax(0, 1fr) 330px" } } as const satisfies SxProps<Theme>;

/** A detail page's second row: stats beside the abilities. Content height - nothing here stretches. The enemy page stretches it instead. */
export const STATS_ROW_SX: SxProps<Theme> = { display: "grid", gap: 2, alignItems: "start", gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "360px minmax(0, 1fr)" } };

/** The enemy page's second row: `STATS_ROW_SX` stretched, so the column beside Stats lines up with it when that column's text is shorter. */
export const STATS_ROW_STRETCH_SX: SxProps<Theme> = { ...STATS_ROW_SX, alignItems: "stretch" };

/**
 * The column beside Stats on the enemy page: Abilities at the height its text needs, Handbook taking the rest. When the text is longer than
 * Stats, the row grows to fit it rather than hiding it behind a scrollbar.
 */
export const STATS_SIDE_COLUMN_SX: SxProps<Theme> = { display: "grid", gap: 2, gridTemplateRows: "auto 1fr", minWidth: 0 };

/** A stats card's row: a thin rule under each row but the last. */
export const STAT_ROW_SX = { py: 0.625, borderBottom: 1, borderColor: "divider", "&:last-of-type": { borderBottom: 0 } } as const satisfies SxProps<Theme>;
