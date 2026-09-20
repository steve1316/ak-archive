// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// The site theme

import { createArchiveTheme } from "archive-kit";
import type { DomainColours } from "archive-kit";

/**
 * Star colours by rarity, keyed by the 1-6 star count rather than the game's `TIER_n` string.
 *
 * The importer converts `TIER_1`..`TIER_6` to 1..6, so nothing below the data layer ever sees the enum.
 */
const RARITY_COLOURS: DomainColours = {
	1: "#9f9f9f",
	2: "#dce537",
	3: "#00b2f6",
	4: "#d8d8d8",
	5: "#ffd800",
	6: "#ff7f27"
};

/** The site's theme. Arknights reads near-black with a high-contrast blue, where GFL is warm grey and amber. */
export const theme = createArchiveTheme({
	palette: {
		mode: "dark",
		primary: { main: "#0098dc", contrastText: "#0d0e12" },
		secondary: { main: "#ff7f27", contrastText: "#0d0e12" },
		background: { default: "#0d0e12", paper: "#16181f" },
		text: { primary: "#e6e8ee", secondary: "#8b90a0" },
		divider: "#242833",
		raised: "#1d202a",
		rarity: RARITY_COLOURS
	}
});
