import { memo, useEffect, useMemo, useRef, useState } from "react";

import { Box, ButtonBase, Chip, TextField, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import { Link } from "react-router-dom";
import presence from "virtual:asset-presence";

import { LoadError } from "archive-kit";

import { hasIllustration, hasPortrait, illustrationUrl, portraitUrl } from "../../lib/assets.js";
import { searchIndex } from "../../lib/data.js";
import { isTextTarget } from "../../lib/keys.js";
import { CHIP_SELECTED_SX, CHIP_UNSELECTED_SX } from "../../lib/layout.js";
import { loadStoryGroup } from "../../lib/story.js";
import type { StoryGroup, StoryIndex } from "../../types/story.js";
import { filterOperators, pickSkinKey, recordOperators } from "./records.js";
import type { RecordOperator } from "./records.js";

/** The classes, in the game's order, for the class filter. */
const CLASSES = ["Vanguard", "Guard", "Defender", "Sniper", "Caster", "Medic", "Supporter", "Specialist"];

/** The star counts, highest first, for the rarity filter. */
const RARITIES = [6, 5, 4, 3, 2, 1];

/** Every operator's published illustration variants, which the background art is picked from. */
const ILLUSTRATION_VARIANTS = presence.variants.illustrations ?? {};

/** The whole tab: the list on the left and the selected operator on the right, above the tab bar. */
const BROWSER_SX: SxProps<Theme> = { position: "absolute", inset: "0 0 64px 0", display: "flex", flexDirection: { xs: "column", md: "row" }, zIndex: 2 };

/** The list column: search and filters over the scrolling names and the A-Z jump. */
const LIST_SX: SxProps<Theme> = {
	width: { xs: "100%", md: 360 },
	height: { xs: "45%", md: "auto" },
	flex: "none",
	display: "flex",
	flexDirection: "column",
	borderRight: { md: "1px solid #2a303c" },
	borderBottom: { xs: "1px solid #2a303c", md: "none" },
	background: "rgba(0,0,0,0.35)"
};

/** A letter's heading in the list, pinned while its names scroll past. */
const LETTER_HEADING_SX: SxProps<Theme> = {
	position: "sticky",
	top: 0,
	zIndex: 1,
	background: "rgba(13,15,20,0.96)",
	py: 0.5,
	fontFamily: "Georgia, serif",
	fontStyle: "italic",
	fontWeight: 700,
	fontSize: 16,
	borderBottom: "1px solid #2a303c"
};

/** One operator's row. */
const ROW_SX = {
	display: "grid",
	gridTemplateColumns: "40px 1fr auto",
	gap: 1.25,
	alignItems: "center",
	width: "100%",
	textAlign: "left",
	px: 0.75,
	py: 0.6,
	borderRadius: 1,
	"&:hover": { background: "rgba(255,255,255,0.05)" }
} satisfies SxProps<Theme>;

/** The selected operator's row. */
const ROW_SELECTED_SX = { ...ROW_SX, background: "rgba(30,155,215,0.18)", boxShadow: "inset 3px 0 #1e9bd7", "&:hover": { background: "rgba(30,155,215,0.18)" } } satisfies SxProps<Theme>;

/** A row's small portrait, cropped to the face. */
const THUMB_SX: SxProps<Theme> = { width: 40, height: 40, objectFit: "cover", objectPosition: "top", borderRadius: 1, background: "#1b202a" };

/** The background art, slid right so its right quarter is cut off and the operator stands clear of the text. */
const SKIN_SX: SxProps<Theme> = {
	position: "absolute",
	top: 0,
	left: "25%",
	width: "100%",
	height: "100%",
	objectFit: "cover",
	objectPosition: "center 20%",
	filter: "brightness(0.55)",
	animation: "recordSkinIn 0.5s ease-out",
	"@keyframes recordSkinIn": { from: { opacity: 0 }, to: { opacity: 1 } }
};

/** The dark fade over the left of the art, so the text stays readable. */
const SHADE_SX: SxProps<Theme> = { position: "absolute", inset: 0, background: "linear-gradient(to right, rgba(13,15,20,0.95) 0%, rgba(13,15,20,0.75) 38%, transparent 70%)" };

/** One record set's card. */
const SET_SX: SxProps<Theme> = { background: "rgba(0,0,0,0.6)", border: "1px solid #2a303c", borderLeft: "3px solid #1e9bd7", borderRadius: 1, p: "12px 14px", mb: 1.5 };

/** One story's row in a set. */
const STORY_SX: SxProps<Theme> = {
	display: "grid",
	gridTemplateColumns: "1fr auto",
	gap: 1,
	alignItems: "center",
	py: 0.75,
	borderTop: "1px solid rgba(255,255,255,0.06)",
	color: "inherit",
	textDecoration: "none",
	"&:hover": { color: "primary.main" }
};

/**
 * A star count as stars.
 *
 * @param rarity The star count.
 * @returns The stars.
 */
function stars(rarity: number): string {
	return "★".repeat(rarity);
}

/**
 * A set with one value added, or removed when it is already there.
 *
 * @param set The set.
 * @param value The value to flip.
 * @returns A new set.
 */
function toggled<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
	const next = new Set(set);
	if (next.has(value)) {
		next.delete(value);
	} else {
		next.add(value);
	}
	return next;
}

/**
 * The art behind an operator: a random outfit, else elite art, else the base art.
 *
 * @param id The operator id.
 * @returns The URL, or null when the operator has no illustration.
 */
function skinUrl(id: string): string | null {
	const key = pickSkinKey(ILLUSTRATION_VARIANTS[id] ?? [], Math.random);
	if (key !== null) {
		return illustrationUrl(id, key);
	}
	return hasIllustration(id) ? illustrationUrl(id) : null;
}

/** Props for RecordDetail. */
interface RecordDetailProps {
	/** The operator to show. */
	operator: RecordOperator;
}

/**
 * The selected operator: a random outfit behind them, their stars, class and name, and each record set with its stories linking into the
 * player. The parent keys it on the operator, so each pick draws a fresh outfit and loads that operator's sets.
 *
 * @param props Component props.
 * @returns The detail pane.
 */
const RecordDetail = memo(function RecordDetail({ operator }: RecordDetailProps) {
	const [groups, setGroups] = useState<StoryGroup[] | null>(null);
	const [error, setError] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const art = useMemo(() => skinUrl(operator.id), [operator.id]);

	useEffect(() => {
		let active = true;
		setError(false);
		Promise.all(operator.sets.map((set) => loadStoryGroup(set.group))).then(
			(loaded) => active && setGroups(loaded),
			() => active && setError(true)
		);
		return () => {
			active = false;
		};
	}, [operator.sets, attempt]);

	const sets = operator.sets.length;
	return (
		<Box sx={{ flex: 1, position: "relative", overflow: "hidden", minHeight: 0 }}>
			{art ? <Box component="img" src={art} alt="" sx={SKIN_SX} /> : null}
			<Box sx={SHADE_SX} />
			<Box sx={{ position: "relative", height: "100%", overflowY: "auto", p: { xs: 2.5, md: "32px 36px" } }}>
				<Box sx={{ width: { xs: "100%", md: "60%" } }}>
					<Typography sx={{ color: "#f0c36a" }}>
						{stars(operator.rarity)}{" "}
						<Box component="span" sx={{ color: "text.secondary" }}>
							{operator.profession}
						</Box>
					</Typography>
					<Typography component="h2" sx={{ fontSize: { xs: 26, md: 34 }, fontWeight: 700, lineHeight: 1.2 }}>
						{operator.name}
					</Typography>
					<Typography color="text.secondary" sx={{ mb: 1.5 }}>
						{sets} record {sets === 1 ? "set" : "sets"}
					</Typography>
					{error ? <LoadError what="these record stories" onRetry={() => setAttempt((value) => value + 1)} /> : null}
					{(groups ?? []).map((group) => (
						<Box key={group.id} sx={SET_SX}>
							<Typography component="h3" sx={{ fontSize: 16, fontWeight: 600, mb: 0.5 }}>
								{group.name}
							</Typography>
							{group.stories.map((story) => (
								<Box key={story.id} component={Link} to={`/story/${group.id}/${story.id}`} sx={STORY_SX}>
									<Typography>{story.name}</Typography>
									<Typography variant="caption" sx={{ border: "1px solid #2a303c", borderRadius: 1, px: 0.75, color: "text.secondary" }}>
										{story.tag}
									</Typography>
								</Box>
							))}
						</Box>
					))}
				</Box>
			</Box>
		</Box>
	);
});

/** Props for RecordsBrowser. */
interface RecordsBrowserProps {
	/** The story index, whose record sets list the operators. */
	index: StoryIndex;
	/** The record set the address names, which selects its operator, or null for the first operator in the list. */
	selectedGroup: string | null;
	/** Called with an operator's first record set when the reader selects them, so the address follows. */
	onSelect: (group: string) => void;
}

/**
 * The Operator Records tab: a searchable, filterable list of every operator with record stories, grouped by the letter their name starts with,
 * beside the selected operator's record sets. The arrow keys move through the list as it is filtered.
 *
 * @param props Component props.
 * @returns The tab.
 */
function RecordsBrowser({ index, selectedGroup, onSelect }: RecordsBrowserProps) {
	const [query, setQuery] = useState("");
	const [classes, setClasses] = useState<ReadonlySet<string>>(new Set());
	const [rarities, setRarities] = useState<ReadonlySet<number>>(new Set());
	const list = useRef<HTMLDivElement>(null);

	const operators = useMemo(() => recordOperators(index.records, searchIndex), [index]);
	const visible = useMemo(() => filterOperators(operators, { query, classes, rarities }), [operators, query, classes, rarities]);
	const byLetter = useMemo(() => {
		const letters = new Map<string, RecordOperator[]>();
		for (const operator of visible) {
			const group = letters.get(operator.letter);
			if (group) {
				group.push(operator);
			} else {
				letters.set(operator.letter, [operator]);
			}
		}
		return letters;
	}, [visible]);
	const allLetters = useMemo(() => [...new Set(operators.map((operator) => operator.letter))], [operators]);
	const selected = (selectedGroup ? operators.find((operator) => operator.sets.some((set) => set.group === selectedGroup)) : undefined) ?? visible[0];

	// The arrow keys step through the list as filtered, except while typing in the search box.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (isTextTarget(event.target) || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) {
				return;
			}
			event.preventDefault();
			const position = selected ? visible.indexOf(selected) : -1;
			const next = visible[Math.min(visible.length - 1, Math.max(0, position + (event.key === "ArrowDown" ? 1 : -1)))];
			if (next?.sets[0]) {
				onSelect(next.sets[0].group);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [visible, selected, onSelect]);

	// Keep the selected row in view as the arrow keys move it.
	useEffect(() => {
		list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
	}, [selected]);

	const jumpTo = (letter: string) => {
		const heading = list.current?.querySelector(`[data-letter="${letter}"]`);
		if (heading instanceof HTMLElement && list.current) {
			list.current.scrollTop = heading.offsetTop - list.current.offsetTop;
		}
	};

	return (
		<Box sx={BROWSER_SX}>
			<Box sx={LIST_SX}>
				<Box sx={{ p: "14px 14px 10px", display: "grid", gap: 1, borderBottom: "1px solid #2a303c" }}>
					<TextField
						size="small"
						placeholder={`Search ${operators.length} operators...`}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						slotProps={{ htmlInput: { "aria-label": "Search operators" } }}
					/>
					<Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
						{CLASSES.map((name) => (
							<Chip
								key={name}
								size="small"
								label={name}
								clickable
								onClick={() => setClasses((value) => toggled(value, name))}
								sx={classes.has(name) ? CHIP_SELECTED_SX : CHIP_UNSELECTED_SX}
							/>
						))}
					</Box>
					<Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
						{RARITIES.map((rarity) => (
							<Chip
								key={rarity}
								size="small"
								label={`${rarity}★`}
								clickable
								onClick={() => setRarities((value) => toggled(value, rarity))}
								sx={rarities.has(rarity) ? CHIP_SELECTED_SX : CHIP_UNSELECTED_SX}
							/>
						))}
					</Box>
				</Box>
				<Box sx={{ flex: 1, display: "flex", minHeight: 0 }}>
					<Box ref={list} sx={{ flex: 1, overflowY: "auto", p: "0 8px 12px 14px" }}>
						{visible.length === 0 ? <Typography sx={{ color: "text.secondary", p: 2 }}>No operator matches.</Typography> : null}
						{[...byLetter].map(([letter, group]) => (
							<Box key={letter}>
								<Box data-letter={letter} sx={LETTER_HEADING_SX}>
									{letter}
								</Box>
								{group.map((operator) => (
									<ButtonBase
										key={operator.id}
										aria-current={operator === selected ? "true" : undefined}
										onClick={() => operator.sets[0] && onSelect(operator.sets[0].group)}
										sx={operator === selected ? ROW_SELECTED_SX : ROW_SX}
									>
										{hasPortrait(operator.id) ? <Box component="img" src={portraitUrl(operator.id)} alt="" loading="lazy" sx={THUMB_SX} /> : <Box sx={THUMB_SX} />}
										<Box sx={{ minWidth: 0 }}>
											<Typography noWrap>{operator.name}</Typography>
											<Typography variant="caption" sx={{ color: "text.secondary" }}>
												<Box component="span" sx={{ color: "#f0c36a" }}>
													{stars(operator.rarity)}
												</Box>{" "}
												{operator.profession}
											</Typography>
										</Box>
										<Typography variant="caption" sx={{ color: "text.secondary" }}>
											{operator.sets.length}
										</Typography>
									</ButtonBase>
								))}
							</Box>
						))}
					</Box>
					{/* The A-Z jump needs more height than a phone's short list has, so the search box does its job there. */}
					<Box sx={{ display: { xs: "none", md: "flex" }, flexDirection: "column", justifyContent: "space-between", py: 1, width: 26, flex: "none" }}>
						{allLetters.map((letter) => (
							<ButtonBase
								key={letter}
								disabled={!byLetter.has(letter)}
								onClick={() => jumpTo(letter)}
								sx={{ fontSize: 12, color: "text.secondary", borderRadius: 0.5, "&.Mui-disabled": { opacity: 0.25 }, "&:hover": { color: "#fff" } }}
							>
								{letter}
							</ButtonBase>
						))}
					</Box>
				</Box>
			</Box>
			{selected ? <RecordDetail key={selected.id} operator={selected} /> : <Box sx={{ flex: 1 }} />}
		</Box>
	);
}

export default memo(RecordsBrowser);
