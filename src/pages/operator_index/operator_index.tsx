import { useCallback, useEffect, useMemo, useState } from "react";

import { Box, Container } from "@mui/material";

import { CardGrid, FilterPanel, IndexSummaryBar, LoadError, findNameMatch } from "archive-kit";
import type { ActiveFilter, SortOption } from "archive-kit";

import { loadAllOperators } from "../../lib/data.js";
import type { Operator } from "../../types/operator.js";
import OperatorCard from "./OperatorCard.js";
import OperatorFilterRows, { CLASS_ORDER } from "./OperatorFilterRows.js";

/** What the results can be ordered by. */
type SortKey = "name" | "rarity" | "class";

/** How the index can be ordered. There is no release date in the data, so it is not an option. */
const SORT_OPTIONS: ReadonlyArray<SortOption<SortKey>> = [
	{ value: "rarity", label: "Rarity" },
	{ value: "name", label: "Name" },
	{ value: "class", label: "Class" }
];

/** How many cards fit a row at each breakpoint: five across on a wide screen. */
const CARD_SIZE = { xs: 6, sm: 4, md: 3, lg: 2.4 };

/** Compares text so digits order by value, putting "12F" before "THRM-EX", and case is ignored. Built once rather than per comparison. */
const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** The empty option list, shared so the subclass row's memo keeps one identity while no class is selected. */
const NO_OPTIONS: string[] = [];

/** Where each class sits in the game's own order, so the Class sort matches the order the class chips are drawn in. */
const CLASS_RANK = new Map(CLASS_ORDER.map((profession, index) => [profession, index]));

/** The direction each sort key lands in when it is chosen. Rarity reads best from 6 stars down, the other two read forwards. */
const NATURAL_DESCENDING: Record<SortKey, boolean> = { rarity: true, name: false, class: false };

/**
 * Add a value to a selection, or drop it when it is already selected.
 *
 * @param selection The values currently selected.
 * @param value The value the chip reported.
 * @returns The new selection.
 */
function toggled<T>(selection: T[], value: T): T[] {
	return selection.includes(value) ? selection.filter((entry) => entry !== value) : [...selection, value];
}

/**
 * Collect one filter axis's options out of the operators.
 *
 * @param operators The operators to read.
 * @param read Pulls one operator's values for this axis. Nulls are dropped, which is how an operator with no nation or no team is handled.
 * @returns The values, unique and sorted.
 */
function optionsOf(operators: readonly Operator[], read: (operator: Operator) => ReadonlyArray<string | null>): string[] {
	const values = new Set<string>();
	for (const operator of operators) {
		for (const value of read(operator)) {
			if (value) {
				values.add(value);
			}
		}
	}
	return [...values].sort(COLLATOR.compare);
}

/**
 * Sort the matching operators. Ties always fall back to the name in A-Z order, whichever way the primary key runs.
 *
 * @param operators The matching operators, left unchanged.
 * @param key What to sort by.
 * @param descending Whether to reverse the order.
 * @returns A sorted copy.
 */
function sortOperators(operators: Operator[], key: SortKey, descending: boolean): Operator[] {
	const direction = descending ? -1 : 1;
	return [...operators].sort((a, b) => {
		let order: number;
		switch (key) {
			case "rarity":
				order = a.rarity - b.rarity;
				break;
			case "class":
				// An unknown class sorts last rather than first, which is what a -1 from a plain lookup would have done.
				order = (CLASS_RANK.get(a.profession) ?? CLASS_ORDER.length) - (CLASS_RANK.get(b.profession) ?? CLASS_ORDER.length);
				break;
			case "name":
				order = COLLATOR.compare(a.name, b.name);
				break;
		}
		return direction * order || COLLATOR.compare(a.name, b.name);
	});
}

/**
 * The operator index: every operator as a card, over a set of filters.
 *
 * The page renders every match rather than paging, which is up to all 412 cards, so each value the grid depends on is derived once with
 * `useMemo` and each chip row gets one stable handler rather than an arrow per chip.
 *
 * @returns The page.
 */
export default function OperatorIndex() {
	const [operators, setOperators] = useState<Operator[] | null>(null);
	const [error, setError] = useState(false);
	// Bumped by the retry button to run the load again. Shards that did load stay cached in the data store.
	const [attempt, setAttempt] = useState(0);

	const [rarities, setRarities] = useState<number[]>([]);
	const [classes, setClasses] = useState<string[]>([]);
	const [subclasses, setSubclasses] = useState<string[]>([]);
	const [faction, setFaction] = useState("");
	const [positions, setPositions] = useState<string[]>([]);
	const [tags, setTags] = useState<string[]>([]);
	const [query, setQuery] = useState("");
	const [sortKey, setSortKey] = useState<SortKey>("rarity");
	const [sortDescending, setSortDescending] = useState(NATURAL_DESCENDING.rarity);

	// The index is the one route that legitimately loads every shard, since it genuinely draws every operator.
	useEffect(() => {
		let active = true;
		setError(false);
		loadAllOperators().then(
			(loaded) => active && setOperators(loaded),
			() => active && setError(true)
		);
		return () => {
			active = false;
		};
	}, [attempt]);

	// Only the selected classes' archetypes, which is 7 to 14 rather than all 71. No class selected means no row at all.
	const subclassOptions = useMemo(() => {
		if (!operators || classes.length === 0) {
			return NO_OPTIONS;
		}
		return optionsOf(
			operators.filter((operator) => classes.includes(operator.profession)),
			(operator) => [operator.subProfession]
		);
	}, [operators, classes]);

	// What the subclass filter actually narrows by. Deselecting a class takes its archetypes off screen, and a criterion with no chip to explain
	// it must stop filtering in the very same paint, so this is derived during render rather than corrected afterwards in an effect.
	const activeSubclasses = useMemo(() => subclasses.filter((subclass) => subclassOptions.includes(subclass)), [subclasses, subclassOptions]);

	const factionOptions = useMemo(() => (operators ? optionsOf(operators, (operator) => [operator.nation, operator.group, operator.team]) : NO_OPTIONS), [operators]);

	const tagOptions = useMemo(() => (operators ? optionsOf(operators, (operator) => operator.tags) : NO_OPTIONS), [operators]);

	// Each axis is an OR within itself and an AND against the others, so picking two classes widens and adding a tag narrows.
	const filtered = useMemo(() => {
		if (!operators) {
			return [];
		}
		const needle = query.trim();
		return operators.filter((operator) => {
			if (rarities.length > 0 && !rarities.includes(operator.rarity)) {
				return false;
			}
			if (classes.length > 0 && !classes.includes(operator.profession)) {
				return false;
			}
			if (activeSubclasses.length > 0 && !activeSubclasses.includes(operator.subProfession)) {
				return false;
			}
			if (faction !== "" && operator.nation !== faction && operator.group !== faction && operator.team !== faction) {
				return false;
			}
			if (positions.length > 0 && !positions.includes(operator.position)) {
				return false;
			}
			if (tags.length > 0 && !tags.some((tag) => operator.tags.includes(tag))) {
				return false;
			}
			// `findNameMatch` reports null for an empty query as well as for a miss, so the empty case is answered before asking it.
			if (needle !== "" && findNameMatch(operator.name, needle) === null) {
				return false;
			}
			return true;
		});
	}, [operators, rarities, classes, activeSubclasses, faction, positions, tags, query]);

	const sorted = useMemo(() => sortOperators(filtered, sortKey, sortDescending), [filtered, sortKey, sortDescending]);

	// The page draws every match rather than paging, so the shown range is always the whole of it. Saying "1-11 of 11" still tells the reader
	// what the list was narrowed from, where "11 of 11" reads as though nothing was filtered.
	const rangeLabel = sorted.length === 0 ? "0" : `1-${sorted.length}`;

	// Settles the stored selection to match what is derived above. Nothing on screen waits for this, since `activeSubclasses` already has the
	// answer during render. It exists so a dropped archetype is gone for good: without it the value would sit in state unseen and come back
	// selected the moment its class was picked again, filtering by something the reader never re-chose. The identity check stops it looping.
	useEffect(() => {
		setSubclasses((current) => {
			const kept = current.filter((subclass) => subclassOptions.includes(subclass));
			return kept.length === current.length ? current : kept;
		});
	}, [subclassOptions]);

	// One stable handler per row, not one per chip: `FilterChip` is memoised and hands its own value back precisely so a row can share one.
	const handleToggleRarity = useCallback((value?: string | number) => setRarities((current) => toggled(current, Number(value))), []);

	const handleToggleClass = useCallback((value?: string | number) => setClasses((current) => toggled(current, String(value))), []);

	const handleToggleSubclass = useCallback((value?: string | number) => setSubclasses((current) => toggled(current, String(value))), []);

	const handleTogglePosition = useCallback((value?: string | number) => setPositions((current) => toggled(current, String(value))), []);

	const handleToggleTag = useCallback((value?: string | number) => setTags((current) => toggled(current, String(value))), []);

	const handleClearFaction = useCallback(() => setFaction(""), []);

	const handleClearQuery = useCallback(() => setQuery(""), []);

	const handleToggleSortDirection = useCallback(() => setSortDescending((descending) => !descending), []);

	// A new key lands in the direction that key reads best in, so switching from Rarity to Name gives A-Z rather than inheriting 6-stars-first
	// as Z-A. Re-picking the key already in use is left alone, since the reader may have flipped the arrow by hand since choosing it.
	const handleSortKeyChange = useCallback(
		(key: SortKey) => {
			if (key === sortKey) {
				return;
			}
			setSortKey(key);
			setSortDescending(NATURAL_DESCENDING[key]);
		},
		[sortKey]
	);

	const handleRetry = useCallback(() => setAttempt((current) => current + 1), []);

	// Clears every filter at once. The sort is left alone, since it is not a filter.
	const handleClearAll = useCallback(() => {
		setRarities([]);
		setClasses([]);
		setSubclasses([]);
		setFaction("");
		setPositions([]);
		setTags([]);
		setQuery("");
	}, []);

	// Every active filter as one removable chip, each keeping its own delete handler so it clears only itself.
	const activeFilters = useMemo<ActiveFilter[]>(
		() => [
			...rarities.map((rarity) => ({ id: `rarity-${rarity}`, label: `${rarity}★`, onDelete: () => handleToggleRarity(rarity) })),
			...classes.map((profession) => ({ id: `class-${profession}`, label: profession, onDelete: () => handleToggleClass(profession) })),
			...activeSubclasses.map((subclass) => ({ id: `subclass-${subclass}`, label: subclass, onDelete: () => handleToggleSubclass(subclass) })),
			...(faction === "" ? [] : [{ id: "faction", label: faction, onDelete: handleClearFaction }]),
			...positions.map((position) => ({ id: `position-${position}`, label: position, onDelete: () => handleTogglePosition(position) })),
			...tags.map((tag) => ({ id: `tag-${tag}`, label: tag, onDelete: () => handleToggleTag(tag) })),
			...(query.trim() === "" ? [] : [{ id: "name", label: `"${query.trim()}"`, onDelete: handleClearQuery }])
		],
		[
			rarities,
			classes,
			activeSubclasses,
			faction,
			positions,
			tags,
			query,
			handleToggleRarity,
			handleToggleClass,
			handleToggleSubclass,
			handleClearFaction,
			handleTogglePosition,
			handleToggleTag,
			handleClearQuery
		]
	);

	// Built once per filter change rather than per render, so a keystroke in the name search re-renders the panel without touching the 44
	// faction menu items and the 34 chips underneath it.
	const filterRows = useMemo(
		() => (
			<OperatorFilterRows
				rarities={rarities}
				onToggleRarity={handleToggleRarity}
				classes={classes}
				onToggleClass={handleToggleClass}
				subclassOptions={subclassOptions}
				subclasses={subclasses}
				onToggleSubclass={handleToggleSubclass}
				factionOptions={factionOptions}
				faction={faction}
				onFactionChange={setFaction}
				positions={positions}
				onTogglePosition={handleTogglePosition}
				tagOptions={tagOptions}
				tags={tags}
				onToggleTag={handleToggleTag}
			/>
		),
		[
			rarities,
			classes,
			subclassOptions,
			subclasses,
			factionOptions,
			faction,
			positions,
			tagOptions,
			tags,
			handleToggleRarity,
			handleToggleClass,
			handleToggleSubclass,
			handleTogglePosition,
			handleToggleTag
		]
	);

	return (
		<Container component="main" maxWidth="lg" sx={{ py: 3 }}>
			{error ? (
				<LoadError what="the operator list" onRetry={handleRetry} />
			) : (
				<>
					<FilterPanel activeCount={activeFilters.length} onClear={handleClearAll} nameQuery={query} onNameQueryChange={setQuery} nameLabel="Search operators by name">
						{filterRows}
					</FilterPanel>
					<IndexSummaryBar
						rangeLabel={rangeLabel}
						total={sorted.length}
						activeFilters={activeFilters}
						sortId="operator-sort"
						sortOptions={SORT_OPTIONS}
						sortKey={sortKey}
						onSortKeyChange={handleSortKeyChange}
						sortDescending={sortDescending}
						onToggleSortDirection={handleToggleSortDirection}
					/>
					<Box sx={{ pt: 3, pb: 6 }}>
						<CardGrid items={sorted} getKey={(operator) => operator.id} renderItem={(operator) => <OperatorCard operator={operator} query={query} />} size={CARD_SIZE} />
					</Box>
				</>
			)}
		</Container>
	);
}
