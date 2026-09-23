import { useCallback, useEffect, useMemo, useState } from "react";

import { Box, ButtonBase, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";

import { LoadError, ScrollToTop } from "archive-kit";

import { hasPortrait, portraitUrl } from "../../lib/assets.js";
import { searchIndex } from "../../lib/data.js";
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

/** One tab's key. */
type TabKey = (typeof TABS)[number]["key"];

/** Operator names by id, for the Records tab. Read once from the search index already in the bundle. */
const NAME_BY_ID = new Map(searchIndex.map((entry) => [entry.id, entry.name]));

/** The picker's frame: the dark area under the bar. */
const FRAME_SX: SxProps<Theme> = { position: "relative", height: "calc(100vh - 64px)", minHeight: 520, overflow: "hidden", background: "#0d0f14", color: "#e6e8ec" };

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
const TAB_BAR_SX: SxProps<Theme> = { position: "absolute", left: 0, right: 0, bottom: 0, height: 64, display: "flex", background: "linear-gradient(transparent, rgba(0,0,0,0.9) 40%)", zIndex: 6 };

/**
 * Which tab a group belongs to.
 *
 * @param index The story index.
 * @param id The group id.
 * @returns The tab, or null when the group is not in the index.
 */
function tabOf(index: StoryIndex, id: string): TabKey | null {
	if (index.main.some((group) => group.id === id)) {
		return "main";
	}
	if (index.events.some((group) => group.id === id)) {
		return "events";
	}
	if (index.side.some((group) => group.id === id)) {
		return "side";
	}
	return index.records.some((entry) => entry.sets.some((set) => set.group === id)) ? "records" : null;
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
 * The Events and Side Stories rail: one entry per year, holding that year's groups.
 *
 * @param groups The tab's groups, by start time.
 * @returns The rail entries.
 */
function yearRail(groups: StoryGroupMeta[]): { key: string; title: string; holds: string[] }[] {
	const years = new Map<string, string[]>();
	for (const group of groups) {
		const year = yearOf(group)?.toString() ?? "Undated";
		years.set(year, [...(years.get(year) ?? []), group.id]);
	}
	return [...years.entries()].map(([year, ids]) => ({ key: year, title: `${ids.length} ${ids.length === 1 ? "story" : "stories"}`, holds: ids }));
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
				inset: "0 0 64px 0",
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
					) : null}
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
	const [openGroup, setOpenGroup] = useState<string | null>(groupParam ?? null);

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

	// A `/stories/:group` link opens that group's tab, selects it and shows its stories.
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
		setOpenGroup(groupParam);
	}, [data, groupParam]);

	const groups = useMemo(() => (data && tab !== "records" ? data.index[tab] : []), [data, tab]);
	const position = tab !== "records" ? selected[tab] : 0;
	const current = groups[position];

	const discItems = useMemo<DiscItem[]>(
		() =>
			groups.map((group, index) => ({
				id: group.id,
				title: group.name,
				label: tab === "main" ? `EPISODE ${String(index).padStart(2, "0")}` : (yearOf(group)?.toString() ?? ""),
				cover: data ? storyAssetUrl("covers", group.id, data.presence) : null
			})),
		[groups, tab, data]
	);

	const select = useCallback(
		(index: number) => {
			if (tab !== "records") {
				setSelected((value) => ({ ...value, [tab]: index }));
				setOpenGroup((open) => (open ? (groups[index]?.id ?? null) : null));
			}
		},
		[tab, groups]
	);

	const open = useCallback(() => {
		if (current) {
			setOpenGroup(current.id);
			navigate(`/stories/${current.id}`, { replace: true });
		}
	}, [current, navigate]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (tab === "records" || event.target instanceof HTMLInputElement) {
				return;
			}
			if (event.key === "ArrowDown" || event.key === "ArrowRight") {
				select(Math.min(groups.length - 1, position + 1));
			} else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
				select(Math.max(0, position - 1));
			} else if (event.key === "Enter") {
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
	const railGroups = tab === "main" ? data.index.acts.map((act) => ({ key: act.id, title: act.name, holds: act.groups })) : yearRail(groups);

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
					<Box sx={{ position: "absolute", left: 0, top: 0, bottom: 64, width: { xs: "100%", md: "40%" }, p: "28px 0 0 28px", overflowY: "auto", zIndex: 3 }}>
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
												{tab === "main" ? `EPISODE ${String(position).padStart(2, "0")}` : `${current.stories} STORIES`}
											</Typography>
										</Box>
									) : null}
								</Box>
							);
						})}
					</Box>
					<Box sx={{ position: "absolute", inset: "0 0 64px 0", zIndex: 2 }}>
						<DiscWheel items={discItems} index={position} onSelect={select} onOpen={open} />
					</Box>
				</>
			) : (
				<RecordsGrid index={data.index} onOpen={(group) => setOpenGroup(group)} />
			)}
			{openGroup ? (
				<StoryList
					groupId={openGroup}
					subtitle={tab === "main" ? `Episode ${String(position).padStart(2, "0")}` : (TABS.find((entry) => entry.key === tab)?.label ?? "")}
					onClose={() => setOpenGroup(null)}
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
							setOpenGroup(null);
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
