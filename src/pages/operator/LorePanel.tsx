import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, SyntheticEvent } from "react";

import { Box, Button, Paper, Tab, Tabs, Typography, useMediaQuery } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

import type { LoreSection } from "../../types/operator.js";
import { SECTION_HEADING_SX, SECTION_SX, TAB_STRIP_SX, TIGHT_RADIUS } from "../../lib/layout.js";

/** A line that is only a bracketed label, such as `[Classified Log]`. Upstream uses these as headings inside a file. */
const BRACKET_LINE = /^\[[^\]]+\]$/;

/** The card clips the art to its rounded box, and is the art's positioning parent. */
const CARD_STYLE: CSSProperties = { position: "relative", overflow: "hidden" };

/** Everything but the art, lifted above it. */
const CONTENT_SX: SxProps<Theme> = { position: "relative", zIndex: 1, display: "flex", flexDirection: "column" };

/**
 * The operator's art behind the card's right side. It fades out on every edge, and stays fully clear for its first fifth so wide art such as a
 * robot never runs under the text. It reads as a backdrop inside the card rather than a picture pasted into it. It sits a little below the
 * card's top so the top fade does not dim the face. Wide screens only.
 */
const ART_SX: SxProps<Theme> = {
	display: { xs: "none", md: "block" },
	position: "absolute",
	right: 0,
	top: 14,
	bottom: 0,
	width: 520,
	backgroundSize: "auto 150%",
	backgroundPosition: "30% 12%",
	backgroundRepeat: "no-repeat",
	opacity: 0.9,
	pointerEvents: "none",
	maskImage:
		"linear-gradient(90deg, transparent 0%, transparent 22%, rgba(0, 0, 0, 0.5) 42%, #000 65%, #000 80%, transparent 100%), linear-gradient(180deg, transparent 0%, #000 7%, #000 70%, transparent 100%)",
	maskComposite: "intersect"
};

/** On a wide screen the file list sits beside a text column kept to a readable line length. On a phone they stack. */
const LAYOUT_SX: SxProps<Theme> = { display: "grid", gap: { xs: 0, md: 3.5 }, gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "240px minmax(0, 75ch)" } };

/** The file list as horizontal tabs on a phone. */
const TABS_ROW_SX: SxProps<Theme> = { ...TAB_STRIP_SX, flex: "none", mb: 2 };

/** The file list as a vertical index on a wide screen, marked along its left edge. */
const TABS_COLUMN_SX: SxProps<Theme> = {
	alignSelf: "start",
	borderLeft: 1,
	borderColor: "divider",
	"& .MuiTabs-indicator": { left: 0, right: "auto" },
	"& .MuiTab-root": { flexDirection: "row", justifyContent: "flex-start", textAlign: "left", gap: 1.25, minHeight: 38, py: 1, px: 1.25, textTransform: "none", fontWeight: 500 }
};

/** The file number before each title in the vertical index. */
const INDEX_NUMBER_SX: SxProps<Theme> = { font: "600 10px/1 ui-monospace, Consolas, monospace", color: "primary.main", width: 20, textAlign: "left" };

/** The text column: the header, the scrolling text and the foot, stacked. */
const COLUMN_SX: SxProps<Theme> = { minWidth: 0, display: "flex", flexDirection: "column" };

/** The open file's header row. */
const FILE_HEAD_SX: SxProps<Theme> = { flex: "none", display: "flex", alignItems: "baseline", gap: 1.5, pb: 0.75, mb: 1.25, borderBottom: 1, borderColor: "divider" };

/** The numbered file tag. */
const FILE_TAG_SX: SxProps<Theme> = {
	font: "600 11px/1 ui-monospace, Consolas, monospace",
	letterSpacing: "0.12em",
	color: "primary.main",
	border: 1,
	borderColor: "primary.dark",
	px: 0.75,
	py: 0.375,
	borderRadius: TIGHT_RADIUS
};

/** The file's text, at a fixed height that scrolls inside when a file runs long. */
const BODY_SX: SxProps<Theme> = { height: 300, overflowY: "auto", pr: 1, fontSize: 15, lineHeight: 1.72, "& p": { m: 0, mb: "0.55em" } };

/** An in-file label drawn from a bracket line. */
const LABEL_SX: SxProps<Theme> = {
	display: "block",
	font: "600 11.5px/1.2 ui-monospace, Consolas, monospace",
	letterSpacing: "0.08em",
	textTransform: "uppercase",
	color: "primary.main",
	mt: "1em",
	mb: "0.45em"
};

/** The Previous and Next row. On a phone it spans the card, so the right inset keeps Next clear of the kit's scroll-to-top button. */
const FOOT_SX: SxProps<Theme> = { flex: "none", display: "flex", justifyContent: "space-between", mt: 2, pr: { xs: 7, md: 0 }, pt: 1.25, borderTop: 1, borderColor: "divider" };

/**
 * The tag shown before a file's title, such as `FILE 03`.
 *
 * @param index The 0-based file index.
 * @returns The tag.
 */
function fileTag(index: number): string {
	return `FILE ${String(index + 1).padStart(2, "0")}`;
}

/** Props for LorePanel. */
interface LorePanelProps {
	/** The handbook's prose sections, with the record already parsed out by the importer. */
	lore: LoreSection[];
	/** The selected form's illustration, drawn behind the card's right side, or null for none. */
	artUrl: string | null;
}

/**
 * The operator page's handbook, one file at a time. On a wide screen a numbered file index sits beside a text column of about 75 characters,
 * with the operator's art faded in behind the card's right side. On a phone the files become tabs above the text and the art is left out. The
 * text sits in a fixed 300px box that scrolls, back to the top on every switch, and Previous and Next wrap at either end. The two operators with
 * no lore get one explanatory line instead.
 *
 * @param props Component props.
 * @returns The panel.
 */
export default function LorePanel({ lore, artUrl }: LorePanelProps) {
	const wide = useMediaQuery((theme: Theme) => theme.breakpoints.up("md"));
	const [open, setOpen] = useState(0);
	const index = Math.min(open, Math.max(lore.length - 1, 0));
	const section = lore[index];
	const lines = useMemo(
		() =>
			section
				? section.text
						.split("\n")
						.map((line) => line.trim())
						.filter(Boolean)
				: [],
		[section]
	);
	const artStyle = useMemo<CSSProperties | undefined>(() => (artUrl ? { backgroundImage: `url(${artUrl})` } : undefined), [artUrl]);

	// A new file starts at its top, not wherever the last one was scrolled to.
	const bodyRef = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		bodyRef.current?.scrollTo({ top: 0 });
	}, [index]);

	const handleTab = useCallback((_event: SyntheticEvent, value: number) => setOpen(value), []);
	const handlePrevious = useCallback(() => setOpen((current) => (current - 1 + lore.length) % lore.length), [lore.length]);
	const handleNext = useCallback(() => setOpen((current) => (current + 1) % lore.length), [lore.length]);

	return (
		<Paper variant="outlined" sx={SECTION_SX} style={CARD_STYLE}>
			{section !== undefined && artStyle ? <Box sx={ART_SX} style={artStyle} aria-hidden /> : null}
			<Box sx={CONTENT_SX}>
				<Typography variant="h6" component="h2" sx={SECTION_HEADING_SX}>
					Handbook
				</Typography>
				{section === undefined ? (
					<Typography variant="body2" color="text.secondary">
						No handbook entry for this form.
					</Typography>
				) : (
					<Box sx={LAYOUT_SX}>
						<Tabs
							value={index}
							onChange={handleTab}
							orientation={wide ? "vertical" : "horizontal"}
							variant="scrollable"
							allowScrollButtonsMobile
							aria-label="Handbook files"
							sx={wide ? TABS_COLUMN_SX : TABS_ROW_SX}
						>
							{lore.map((entry, position) => (
								<Tab
									key={`${position}-${entry.title}`}
									value={position}
									label={
										wide ? (
											<>
												<Box component="span" sx={INDEX_NUMBER_SX}>
													{String(position + 1).padStart(2, "0")}
												</Box>
												{entry.title}
											</>
										) : (
											entry.title
										)
									}
								/>
							))}
						</Tabs>
						<Box sx={COLUMN_SX}>
							<Box sx={FILE_HEAD_SX}>
								<Box component="span" sx={FILE_TAG_SX}>
									{fileTag(index)}
								</Box>
								<Typography component="h3" sx={{ fontWeight: 700, fontSize: 16 }}>
									{section.title}
								</Typography>
							</Box>
							<Box ref={bodyRef} sx={BODY_SX}>
								{lines.map((line, position) =>
									BRACKET_LINE.test(line) ? (
										<Box key={position} component="span" sx={LABEL_SX}>
											{line.slice(1, -1)}
										</Box>
									) : (
										<p key={position}>{line}</p>
									)
								)}
							</Box>
							{lore.length > 1 ? (
								<Box sx={FOOT_SX}>
									<Button variant="outlined" size="small" onClick={handlePrevious}>
										‹ Previous file
									</Button>
									<Button variant="outlined" size="small" onClick={handleNext}>
										Next file ›
									</Button>
								</Box>
							) : null}
						</Box>
					</Box>
				)}
			</Box>
		</Paper>
	);
}
