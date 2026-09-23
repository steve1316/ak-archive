import { useCallback, useEffect, useMemo, useState } from "react";

import { Box, ButtonBase, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";

import { ArtPlaceholder, LoadError, ScrollToTop } from "archive-kit";

import { hasPortrait, portraitUrl } from "../../lib/assets.js";
import { searchIndex } from "../../lib/data.js";
import { isControlTarget } from "../../lib/keys.js";
import { NAVBAR_HEIGHT } from "../../lib/layout.js";
import { storyGroupPath } from "../../lib/routes.js";
import { loadStoryIndex, loadStoryPresence, storyAssetUrl } from "../../lib/story.js";
import type { StoryPresence } from "../../lib/story.js";
import type { StoryGroupMeta, StoryIndex } from "../../types/story.js";
import DiscWheel from "./DiscWheel.js";
import type { DiscItem } from "./DiscWheel.js";
import StoryList from "./StoryList.js";

/** The picker's tabs, in order. */
const TABS = [
	{ key: "main", label: "Main Theme" },
	{ key: "events", label: "Events" },
	{ key: "side", label: "Side Stories" },
	{ key: "records", label: "Operator Records" }
] as const;

/** The year shown for a group upstream never dated. The index sorts such groups first, so they lead the rail. */
const UNDATED_YEAR = "0000";

/** What a year on the Events and Side Stories rails counts. */
const EVENT_NOUN = { one: "event", many: "events" };
const SIDE_NOUN = { one: "side story", many: "side stories" };

/** One tab's key. */
type TabKey = (typeof TABS)[number]["key"];

/** Operator names by id, for the Records tab. Read once from the search index already in the bundle. */
const NAME_BY_ID = new Map(searchIndex.map((entry) => [entry.id, entry.name]));

/** The height of the tab bar along the bottom, which the rail, disc and records grid stop above. */
const TAB_BAR_HEIGHT = 64;

/** The picker's frame: the dark area under the bar. */
const FRAME_SX: SxProps<Theme> = { position: "relative", height: `calc(100vh - ${NAVBAR_HEIGHT}px)`, minHeight: 520, overflow: "hidden", background: "#0d0f14", color: "#e6e8ec" };

/** The blurred art behind the picker. */
const BACKDROP_SX: SxProps<Theme> = {
	position: "absolute",
	inset: -20,
	backgroundSize: "cover",
	backgroundPosition: "center",
	filter: "blur(3px) brightness(0.45)",
	transition: "background-image 0.4s"
};

/** The tab bar along the bottom. */
const TAB_BAR_SX: SxProps<Theme> = {
	position: "absolute",
	left: 0,
	right: 0,
	bottom: 0,
	height: TAB_BAR_HEIGHT,
	display: "flex",
	background: "linear-gradient(transparent, rgba(0,0,0,0.9) 40%)",
	zIndex: 6
};

/**
 * Which tab a group belongs to.
 *
 * @param index The story index.
 * @param id The group id.
 * @returns The tab, or null when the group is not in the index.
 */
function tabOf(index: StoryIndex, id: string): TabKey | null {
	for (const tab of ["main", "events", "side"] as const) {
		if (index[tab].some((group) => group.id === id)) {
			return tab;
		}
	}
	return index.records.some((entry) => entry.sets.some((set) => set.group === id)) ? "records" : null;
}

/**
 * A main story episode's number, such as `03`.
 *
 * @param position The episode's place in the main story.
 * @returns The number, two digits wide.
 */
function episodeNumber(position: number): string {
	return String(position).padStart(2, "0");
}

/**
 * The year a group first showed, for the Events and Side Stories rail.
 *
 * @param group The group.
 * @returns The year, or null.
 */
function yearOf(group: StoryGroupMeta): number | null {
	return group.start ? new Date(group.start * 1000).getUTCFullYear() : null;
}

/**
 * The Events and Side Stories rail: one entry per year, holding that year's groups and counting them as events or side stories, so the count
 * never reads like a group's own story count.
 *
 * @param groups The tab's groups, by start time.
 * @param noun What one group is called on this tab, singular and plural.
 * @returns The rail entries.
 */
function yearRail(groups: StoryGroupMeta[], noun: { one: string; many: string }): { key: string; title: string; holds: string[] }[] {
	const years = new Map<string, string[]>();
	for (const group of groups) {
		const year = yearOf(group)?.toString() ?? UNDATED_YEAR;
		const ids = years.get(year);
		if (ids) {
			ids.push(group.id);
		} else {
			years.set(year, [group.id]);
		}
	}
	return [...years.entries()].map(([year, ids]) => ({ key: year, title: `${ids.length} ${ids.length === 1 ? noun.one : noun.many}`, holds: ids }));
}

/** Props for RecordsGrid. */
interface RecordsGridProps {
	/** The story index. */
	index: StoryIndex;
	/** Called with a record set's group id to list its stories. */
	onOpen: (group: string) => void;
}

/**
 * The Operator Records tab: every operator with record stories, by name, each showing their sets.
 *
 * @param props Component props.
 * @returns The grid.
 */
function RecordsGrid({ index, onOpen }: RecordsGridProps) {
	const operators = useMemo(() => index.records.map((entry) => ({ ...entry, name: NAME_BY_ID.get(entry.operator) ?? entry.operator })).sort((a, b) => a.name.localeCompare(b.name)), [index]);
	return (
		<Box
			sx={{
				position: "absolute",
				inset: `0 0 ${TAB_BAR_HEIGHT}px 0`,
				overflowY: "auto",
				p: 2.5,
				zIndex: 3,
				display: "grid",
				gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
				gap: 1.5,
				alignContent: "start"
			}}
		>
			{operators.map((entry) => (
				<Box key={entry.operator} sx={{ background: "rgba(22,26,34,0.9)", border: "1px solid #2a303c", borderRadius: 1, overflow: "hidden" }}>
					{hasPortrait(entry.operator) ? (
						<Box component="img" src={portraitUrl(entry.operator)} alt="" loading="lazy" sx={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", objectPosition: "top" }} />
					) : (
						<ArtPlaceholder name={entry.name} aspect="1 / 1" />
					)}
					<Box sx={{ p: 1 }}>
						<Typography variant="subtitle2">{entry.name}</Typography>
						{entry.sets.map((set) => (
							<ButtonBase key={set.group} onClick={() => onOpen(set.group)} sx={{ display: "block", textAlign: "left", color: "primary.main", fontSize: 13, py: 0.25 }}>
								{set.name}
							</ButtonBase>
						))}
					</Box>
				</Box>
			))}
		</Box>
	);
}

/**
 * The story picker: acts and a disc of episode covers for the main story, the same disc by year for events and side stories, and a grid of
 * operators for their records. The selected group's stories slide in from the left.
 *
 * @returns The page.
 */
export default function Stories() {
	const { group: groupParam } = useParams();
	const navigate = useNavigate();
	const [data, setData] = useState<{ index: StoryIndex; presence: StoryPresence } | null>(null);
	const [error, setError] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const [tab, setTab] = useState<TabKey>("main");
	const [selected, setSelected] = useState<Record<Exclude<TabKey, "records">, number>>({ main: 0, events: 0, side: 0 });
	// The open story list lives in the address, so a refresh, the back button and the navbar's Stories link all agree with the page.
	const openGroup = groupParam ?? null;

	useEffect(() => {
		let active = true;
		setError(false);
		Promise.all([loadStoryIndex(), loadStoryPresence()]).then(
			([index, presence]) => active && setData({ index, presence }),
			() => active && setError(true)
		);
		return () => {
			active = false;
		};
	}, [attempt]);

	const showGroup = useCallback((id: string | null) => navigate(storyGroupPath(id), { replace: true }), [navigate]);

	// A `/stories/:group` address opens that group's tab and selects it. The list itself follows the address.
	useEffect(() => {
		if (!data || !groupParam) {
			return;
		}
		const groupTab = tabOf(data.index, groupParam);
		if (!groupTab) {
			return;
		}
		setTab(groupTab);
		if (groupTab !== "records") {
			const position = data.index[groupTab].findIndex((group) => group.id === groupParam);
			setSelected((current) => ({ ...current, [groupTab]: Math.max(0, position) }));
		}
	}, [data, groupParam]);

	const groups = useMemo(() => (data && tab !== "records" ? data.index[tab] : []), [data, tab]);
	const position = tab !== "records" ? selected[tab] : 0;
	const current = groups[position];

	const discItems = useMemo<DiscItem[]>(
		() =>
			groups.map((group, index) => ({
				id: group.id,
				title: group.name,
				label: tab === "main" ? `EPISODE ${episodeNumber(index)}` : (yearOf(group)?.toString() ?? UNDATED_YEAR),
				cover: data ? storyAssetUrl("covers", group.id, data.presence) : null
			})),
		[groups, tab, data]
	);

	const select = useCallback(
		(index: number) => {
			if (tab !== "records") {
				setSelected((value) => ({ ...value, [tab]: index }));
				if (openGroup) {
					showGroup(groups[index]?.id ?? null);
				}
			}
		},
		[tab, groups, openGroup, showGroup]
	);

	const closeList = useCallback(() => showGroup(null), [showGroup]);

	const railGroups = useMemo(
		() => (tab === "main" ? (data?.index.acts ?? []).map((act) => ({ key: act.id, title: act.name, holds: act.groups })) : yearRail(groups, tab === "events" ? EVENT_NOUN : SIDE_NOUN)),
		[data, tab, groups]
	);

	const open = useCallback(() => {
		if (current) {
			showGroup(current.id);
		}
	}, [current, showGroup]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (tab === "records" || event.target instanceof HTMLInputElement) {
				return;
			}
			if (event.key === "ArrowDown" || event.key === "ArrowRight") {
				select(Math.min(groups.length - 1, position + 1));
			} else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
				select(Math.max(0, position - 1));
			} else if (event.key === "Enter" && !isControlTarget(event.target)) {
				// Enter on a focused tab, link or button keeps its own meaning.
				open();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [tab, groups.length, position, select, open]);

	useEffect(() => {
		document.title = "Stories - Arknights Archive";
	}, []);

	if (error) {
		return <LoadError what="the story index" onRetry={() => setAttempt((value) => value + 1)} titleComponent="h1" />;
	}
	if (!data) {
		return (
			<Typography color="text.secondary" role="status" sx={{ p: 3 }}>
				Loading...
			</Typography>
		);
	}

	const backdrop = current ? (storyAssetUrl("maps", current.id, data.presence) ?? storyAssetUrl("covers", current.id, data.presence)) : null;

	return (
		<Box component="main" sx={FRAME_SX}>
			<ScrollToTop />
			<Typography component="h1" sx={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
				Stories
			</Typography>
			<Box sx={BACKDROP_SX} style={{ backgroundImage: backdrop ? `url(${backdrop})` : "none" }} />
			<Box sx={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 70% 50%, transparent 30%, rgba(0,0,0,0.75) 100%)", pointerEvents: "none" }} />
			{tab !== "records" ? (
				<>
					<Box sx={{ position: "absolute", left: 0, top: 0, bottom: TAB_BAR_HEIGHT, width: { xs: "100%", md: "40%" }, p: "28px 0 0 28px", overflowY: "auto", zIndex: 3 }}>
						{railGroups.map((entry, railIndex) => {
							const holdsCurrent = current ? entry.holds.includes(current.id) : false;
							return (
								<Box key={entry.key} sx={{ mb: holdsCurrent ? 0 : 2.25 }}>
									<ButtonBase
										onClick={() =>
											select(
												Math.max(
													0,
													groups.findIndex((group) => group.id === entry.holds[0])
												)
											)
										}
										sx={{ display: "flex", gap: 1.75, alignItems: "center", opacity: holdsCurrent ? 1 : 0.55, textAlign: "left" }}
									>
										<Box
											sx={{
												width: 46,
												height: 46,
												borderRadius: "50%",
												border: "2px solid",
												borderColor: holdsCurrent ? "#fff" : "rgba(255,255,255,0.5)",
												display: "grid",
												placeItems: "center"
											}}
										>
											<Box sx={{ width: 14, height: 14, borderRadius: "50%", background: "#fff" }} />
										</Box>
										<Box>
											<Typography sx={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontWeight: 700, fontSize: 22 }}>
												{tab === "main" ? `Act ${["0", "I", "II", "III", "IV", "V"][railIndex] ?? railIndex}` : entry.key}
											</Typography>
											<Typography variant="body2" sx={{ color: "#ddd" }}>
												{entry.title}
											</Typography>
										</Box>
									</ButtonBase>
									{holdsCurrent && current ? (
										<Box
											sx={{ m: "4px 0 26px 60px", p: "10px 14px", background: "rgba(0,0,0,0.7)", borderLeft: "3px solid", borderColor: "primary.main", display: "inline-block" }}
										>
											<Typography component="span" sx={{ fontSize: 22, fontWeight: 600 }}>
												{current.name}
											</Typography>
											<Typography component="span" variant="caption" sx={{ letterSpacing: "0.12em", color: "text.secondary", ml: 1 }}>
												{tab === "main" ? `EPISODE ${episodeNumber(position)}` : `${current.stories} STORIES`}
											</Typography>
										</Box>
									) : null}
								</Box>
							);
						})}
					</Box>
					<Box sx={{ position: "absolute", inset: `0 0 ${TAB_BAR_HEIGHT}px 0`, zIndex: 2 }}>
						<DiscWheel items={discItems} index={position} onSelect={select} onOpen={open} />
					</Box>
				</>
			) : (
				<RecordsGrid index={data.index} onOpen={showGroup} />
			)}
			{openGroup ? (
				<StoryList groupId={openGroup} subtitle={tab === "main" ? `Episode ${episodeNumber(position)}` : (TABS.find((entry) => entry.key === tab)?.label ?? "")} onClose={closeList} />
			) : null}
			<Box sx={TAB_BAR_SX} role="tablist">
				{TABS.map((entry) => (
					<ButtonBase
						key={entry.key}
						role="tab"
						aria-selected={tab === entry.key}
						onClick={() => {
							setTab(entry.key);
							if (openGroup) {
								showGroup(null);
							}
						}}
						sx={{
							flex: 1,
							color: tab === entry.key ? "#fff" : "#8a93a3",
							fontWeight: tab === entry.key ? 600 : 400,
							boxShadow: tab === entry.key ? "inset 0 -3px #1e9bd7" : "none",
							borderRight: "1px solid rgba(255,255,255,0.08)"
						}}
					>
						{entry.label}
					</ButtonBase>
				))}
			</Box>
		</Box>
	);
}
