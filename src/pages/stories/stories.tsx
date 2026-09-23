import { useCallback, useEffect, useMemo, useState } from "react";

import { Box, ButtonBase, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";

import { LoadError, ScrollToTop } from "archive-kit";

import { hasPortrait, portraitUrl } from "../../lib/assets.js";
import { searchIndex } from "../../lib/data.js";
import { isControlTarget } from "../../lib/keys.js";
import { NAVBAR_HEIGHT } from "../../lib/layout.js";
import { storyGroupPath } from "../../lib/routes.js";
import { loadStoryIndex, loadStoryPresence, storyAssetUrl } from "../../lib/story.js";
import type { StoryPresence } from "../../lib/story.js";
import type { StoryGroupMeta, StoryIndex } from "../../types/story.js";
import Backdrop from "./Backdrop.js";
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

/** What a year on the Events and Side Stories rails, and a letter on the Operator Records rail, counts. */
const EVENT_NOUN = { one: "event", many: "events" };
const SIDE_NOUN = { one: "side story", many: "side stories" };
const OPERATOR_NOUN = { one: "operator", many: "operators" };

/** The main story's act numerals, by act position. */
const ACT_NUMERALS = ["0", "I", "II", "III", "IV", "V"];

/** One tab's key. */
type TabKey = (typeof TABS)[number]["key"];

/** Operator names by id, for the Records tab. Read once from the search index already in the bundle. */
const NAME_BY_ID = new Map(searchIndex.map((entry) => [entry.id, entry.name]));

/** The height of the tab bar along the bottom, which the rail and disc stop above. */
const TAB_BAR_HEIGHT = 64;

/** The picker's frame: the dark area under the bar. */
const FRAME_SX: SxProps<Theme> = { position: "relative", height: `calc(100vh - ${NAVBAR_HEIGHT}px)`, minHeight: 520, overflow: "hidden", background: "#0d0f14", color: "#e6e8ec" };

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

/** One item on a tab's disc: an episode, event or side story, or one operator's records. */
interface PickerEntry {
	/** The group the item opens and the address names: the group itself, or the operator's first record set. */
	id: string;
	/** Every group the item's story list shows: the group itself, or each of the operator's record sets. */
	groups: string[];
	/** The name shown under the rail and on the disc. */
	name: string;
	/** The line after the name under the rail, such as `16 STORIES`. */
	detail: string;
	/** The caption on a disc item with no cover, such as `EPISODE 03` or the year. */
	label: string;
	/** The disc's art, or null when none is published. */
	cover: string | null;
	/** The art behind the picker, or null. */
	backdrop: string | null;
	/** The rail entry the item sits under: an act id, a year or a letter. */
	rail: string;
}

/** One entry on the rail. */
interface RailEntry {
	/** The rail's key: an act id, a year or a letter. */
	key: string;
	/** The big heading, such as `Act I`, `2021` or `J`. */
	heading: string;
	/** The line under it, such as the act's name or `8 events`. */
	title: string;
	/** The disc items it holds, by id. */
	holds: string[];
}

/**
 * The letter an operator is filed under: the first letter or digit of their name, uppercased, with accents dropped, so `'Justice Knight'`
 * files under J and 12F under 1.
 *
 * @param name The operator's name.
 * @returns The letter, or `#` for a name with no letter or digit.
 */
function letterOf(name: string): string {
	return (
		name
			.normalize("NFD")
			.match(/[\p{L}\p{N}]/u)?.[0]
			?.toUpperCase() ?? "#"
	);
}

/**
 * A tab's disc items, in disc order.
 *
 * @param index The story index.
 * @param presence Which story assets are published.
 * @param tab The tab.
 * @returns The items.
 */
function entriesOf(index: StoryIndex, presence: StoryPresence, tab: TabKey): PickerEntry[] {
	if (tab === "records") {
		return index.records
			.map((record) => ({ record, name: NAME_BY_ID.get(record.operator) ?? record.operator }))
			.sort((a, b) => letterOf(a.name).localeCompare(letterOf(b.name)) || a.name.localeCompare(b.name))
			.flatMap(({ record, name }) => {
				const first = record.sets[0];
				if (!first) {
					return [];
				}
				const art = hasPortrait(record.operator) ? portraitUrl(record.operator) : null;
				const sets = record.sets.length;
				return [
					{
						id: first.group,
						groups: record.sets.map((set) => set.group),
						name,
						detail: `${sets} ${sets === 1 ? "RECORD" : "RECORDS"}`,
						label: `${sets} ${sets === 1 ? "record" : "records"}`,
						cover: art,
						backdrop: art,
						rail: letterOf(name)
					}
				];
			});
	}
	const acts = new Map(index.acts.flatMap((act) => act.groups.map((group) => [group, act.id])));
	return index[tab].map((group, position) => {
		const year = yearOf(group)?.toString() ?? UNDATED_YEAR;
		const cover = storyAssetUrl("covers", group.id, presence);
		return {
			id: group.id,
			groups: [group.id],
			name: group.name,
			detail: tab === "main" ? `EPISODE ${episodeNumber(position)}` : `${group.stories} STORIES`,
			label: tab === "main" ? `EPISODE ${episodeNumber(position)}` : year,
			cover,
			backdrop: storyAssetUrl("maps", group.id, presence) ?? cover,
			rail: tab === "main" ? (acts.get(group.id) ?? "") : year
		};
	});
}

/**
 * A tab's rail: its acts for the main story, or one entry per year or letter holding that year's or letter's items, counted with the tab's
 * noun so the count never reads like a group's own story count.
 *
 * @param index The story index.
 * @param tab The tab.
 * @param entries The tab's disc items.
 * @returns The rail entries, in disc order.
 */
function railOf(index: StoryIndex, tab: TabKey, entries: PickerEntry[]): RailEntry[] {
	if (tab === "main") {
		return index.acts.map((act, position) => ({ key: act.id, heading: `Act ${ACT_NUMERALS[position] ?? position}`, title: act.name, holds: act.groups }));
	}
	const noun = tab === "events" ? EVENT_NOUN : tab === "side" ? SIDE_NOUN : OPERATOR_NOUN;
	const rails = new Map<string, string[]>();
	for (const entry of entries) {
		const ids = rails.get(entry.rail);
		if (ids) {
			ids.push(entry.id);
		} else {
			rails.set(entry.rail, [entry.id]);
		}
	}
	return [...rails.entries()].map(([key, ids]) => ({ key, heading: key, title: `${ids.length} ${ids.length === 1 ? noun.one : noun.many}`, holds: ids }));
}

/**
 * The story picker: acts and a disc of episode covers for the main story, the same disc by year for events and side stories, and by letter
 * for operators and their records. The selected item's stories slide in from the left.
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
	const [selected, setSelected] = useState<Record<TabKey, number>>({ main: 0, events: 0, side: 0, records: 0 });
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
		const position = entriesOf(data.index, data.presence, groupTab).findIndex((entry) => entry.groups.includes(groupParam));
		setSelected((current) => ({ ...current, [groupTab]: Math.max(0, position) }));
	}, [data, groupParam]);

	const entries = useMemo(() => (data ? entriesOf(data.index, data.presence, tab) : []), [data, tab]);
	const position = selected[tab];
	const current = entries[position];
	const openEntry = openGroup ? entries.find((entry) => entry.groups.includes(openGroup)) : undefined;

	const discItems = useMemo<DiscItem[]>(() => entries.map((entry) => ({ id: entry.id, title: entry.name, label: entry.label, cover: entry.cover })), [entries]);

	const select = useCallback(
		(index: number) => {
			setSelected((value) => ({ ...value, [tab]: index }));
			if (openGroup) {
				showGroup(entries[index]?.id ?? null);
			}
		},
		[tab, entries, openGroup, showGroup]
	);

	const closeList = useCallback(() => showGroup(null), [showGroup]);

	const railGroups = useMemo(() => (data ? railOf(data.index, tab, entries) : []), [data, tab, entries]);

	const open = useCallback(() => {
		if (current) {
			showGroup(current.id);
		}
	}, [current, showGroup]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.target instanceof HTMLInputElement) {
				return;
			}
			if (event.key === "ArrowDown" || event.key === "ArrowRight") {
				select(Math.min(entries.length - 1, position + 1));
			} else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
				select(Math.max(0, position - 1));
			} else if (event.key === "Enter" && !isControlTarget(event.target)) {
				// Enter on a focused tab, link or button keeps its own meaning.
				open();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [entries.length, position, select, open]);

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

	const backdrop = current?.backdrop ?? null;

	return (
		<Box component="main" sx={FRAME_SX} data-region="story-picker">
			<ScrollToTop />
			<Typography component="h1" sx={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
				Stories
			</Typography>
			{backdrop ? <Backdrop key={backdrop} url={backdrop} /> : null}
			<Box sx={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 70% 50%, transparent 30%, rgba(0,0,0,0.75) 100%)", pointerEvents: "none" }} />
			<Box sx={{ position: "absolute", left: 0, top: 0, bottom: TAB_BAR_HEIGHT, width: { xs: "100%", md: "40%" }, p: "28px 0 0 28px", overflowY: "auto", zIndex: 3 }}>
				{railGroups.map((entry) => {
					const holdsCurrent = current ? entry.holds.includes(current.id) : false;
					return (
						<Box key={entry.key} sx={{ mb: 2.25 }}>
							<ButtonBase
								onClick={() =>
									select(
										Math.max(
											0,
											entries.findIndex((item) => item.id === entry.holds[0])
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
									<Typography sx={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontWeight: 700, fontSize: 22 }}>{entry.heading}</Typography>
									<Typography variant="body2" sx={{ color: "#ddd" }}>
										{entry.title}
									</Typography>
								</Box>
							</ButtonBase>
							{holdsCurrent && current ? (
								<Box sx={{ m: "4px 0 0 60px", p: "10px 14px", background: "rgba(0,0,0,0.7)", borderLeft: "3px solid", borderColor: "primary.main", width: "fit-content" }}>
									<Typography component="span" sx={{ fontSize: 22, fontWeight: 600 }}>
										{current.name}
									</Typography>
									<Typography component="span" variant="caption" sx={{ letterSpacing: "0.12em", color: "text.secondary", ml: 1 }}>
										{current.detail}
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
			{openGroup ? (
				<StoryList
					groupIds={openEntry?.groups ?? [openGroup]}
					title={tab === "records" ? openEntry?.name : undefined}
					subtitle={tab === "main" ? `Episode ${episodeNumber(position)}` : (TABS.find((entry) => entry.key === tab)?.label ?? "")}
					onClose={closeList}
				/>
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
