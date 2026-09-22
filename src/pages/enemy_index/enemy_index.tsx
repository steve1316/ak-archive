import { useCallback, useEffect, useMemo, useState } from "react";

import { Box, Button, Container, Typography } from "@mui/material";

import { CardGrid, FilterPanel, IndexSummaryBar, LoadError, ScrollToTop, findNameMatch } from "archive-kit";
import type { ActiveFilter, SortOption } from "archive-kit";

import { loadAllEnemies } from "../../lib/data.js";
import { COLLATOR, optionsOf, toggled } from "../../lib/filters.js";
import type { Enemy } from "../../types/enemy.js";
import EnemyCard from "./EnemyCard.js";
import EnemyFilterRows, { LEVEL_ORDER } from "./EnemyFilterRows.js";

/** What the results can be ordered by. */
type SortKey = "handbook" | "name" | "level";

/** How the index can be ordered. Handbook order is the game's own, which groups each faction's enemies together. */
const SORT_OPTIONS: ReadonlyArray<SortOption<SortKey>> = [
	{ value: "handbook", label: "Handbook" },
	{ value: "name", label: "Name" },
	{ value: "level", label: "Level" }
];

/** How many cards fit a row at each breakpoint. The square icon cards are shorter than operator portraits, so one more fits across. */
const CARD_SIZE = { xs: 4, sm: 3, md: 2.4, lg: 2 };

/** Cards drawn before the "Load more" button, as on the operator index. */
const PAGE_SIZE = 30;

/** Where each level sits in the game's own order, so the Level sort matches the chip order. */
const LEVEL_RANK = new Map(LEVEL_ORDER.map((level, index) => [level, index]));

/** The direction each sort key lands in when it is chosen. Level reads best from Leader down, the other two read forwards. */
const NATURAL_DESCENDING: Record<SortKey, boolean> = { handbook: false, name: false, level: true };

/**
 * Sort the matching enemies. Ties fall back to handbook order, whichever way the primary key runs.
 *
 * @param enemies The matching enemies, left unchanged.
 * @param key What to sort by.
 * @param descending Whether to reverse the order.
 * @returns A sorted copy, or `enemies` itself when it is already in the asked order.
 */
function sortEnemies(enemies: Enemy[], key: SortKey, descending: boolean): Enemy[] {
	// `enemies.json` is written in handbook order and filtering keeps it, so the default sort has nothing to do.
	if (key === "handbook" && !descending) {
		return enemies;
	}
	const direction = descending ? -1 : 1;
	return [...enemies].sort((a, b) => {
		let order: number;
		switch (key) {
			case "handbook":
				order = a.sortId - b.sortId;
				break;
			case "level":
				order = (LEVEL_RANK.get(a.level) ?? LEVEL_ORDER.length) - (LEVEL_RANK.get(b.level) ?? LEVEL_ORDER.length);
				break;
			case "name":
				order = COLLATOR.compare(a.name, b.name);
				break;
		}
		return direction * order || a.sortId - b.sortId;
	});
}

/**
 * Whether any of an axis's selected values is among an enemy's values. An empty selection matches everything.
 *
 * @param selected The chips selected on this axis.
 * @param values The enemy group's values on this axis.
 * @returns True when the axis does not rule the enemy out.
 */
function matchesAxis(selected: readonly string[], values: readonly string[]): boolean {
	return selected.length === 0 || selected.some((value) => values.includes(value));
}

/**
 * The enemy index: every enemy group as a card, over a set of filters.
 *
 * Built the same way as the operator index. Each value the grid depends on is derived once with `useMemo`, and each chip row gets one stable
 * handler rather than an arrow per chip. The name search matches every variant's name as well as the head's.
 *
 * @returns The page.
 */
export default function EnemyIndex() {
	const [enemies, setEnemies] = useState<Enemy[] | null>(null);
	const [error, setError] = useState(false);
	// Bumped by the retry button to run the load again.
	const [attempt, setAttempt] = useState(0);

	const [levels, setLevels] = useState<string[]>([]);
	const [races, setRaces] = useState<string[]>([]);
	const [attacks, setAttacks] = useState<string[]>([]);
	const [damages, setDamages] = useState<string[]>([]);
	const [motions, setMotions] = useState<string[]>([]);
	const [query, setQuery] = useState("");
	const [sortKey, setSortKey] = useState<SortKey>("handbook");
	const [sortDescending, setSortDescending] = useState(NATURAL_DESCENDING.handbook);

	useEffect(() => {
		let active = true;
		setError(false);
		loadAllEnemies().then(
			(loaded) => active && setEnemies(loaded),
			() => active && setError(true)
		);
		return () => {
			active = false;
		};
	}, [attempt]);

	const raceOptions = useMemo(() => (enemies ? optionsOf(enemies, (enemy) => enemy.races) : []), [enemies]);

	// Each axis is an OR within itself and an AND against the others. The head's name match is kept for `EnemyCard` to highlight. A group that
	// matched only through a variant's name still shows, just without a highlight on the head's name.
	const { filtered, nameMatches } = useMemo(() => {
		const matches = new Map<string, [number, number]>();
		if (!enemies) {
			return { filtered: [] as Enemy[], nameMatches: matches };
		}
		const needle = query.trim();
		const matched = enemies.filter((enemy) => {
			if (
				!matchesAxis(levels, enemy.levels) ||
				!matchesAxis(races, enemy.races) ||
				!matchesAxis(attacks, enemy.attacks) ||
				!matchesAxis(damages, enemy.damages) ||
				!matchesAxis(motions, enemy.motions)
			) {
				return false;
			}
			if (needle === "") {
				return true;
			}
			const match = findNameMatch(enemy.name, needle);
			if (match !== null) {
				matches.set(enemy.id, match);
				return true;
			}
			return enemy.variants.some((variant) => findNameMatch(variant.name, needle) !== null);
		});
		return { filtered: matched, nameMatches: matches };
	}, [enemies, levels, races, attacks, damages, motions, query]);

	const sorted = useMemo(() => sortEnemies(filtered, sortKey, sortDescending), [filtered, sortKey, sortDescending]);

	const [shown, setShown] = useState(PAGE_SIZE);
	// Back to the first page whenever the list itself changes, set during render as on the operator index.
	const [shownFor, setShownFor] = useState(sorted);
	if (shownFor !== sorted) {
		setShownFor(sorted);
		setShown(PAGE_SIZE);
	}
	const visible = useMemo(() => sorted.slice(0, shown), [sorted, shown]);
	const handleLoadMore = useCallback(() => setShown((current) => current + PAGE_SIZE), []);

	const rangeLabel = sorted.length === 0 ? "0" : `1-${visible.length}`;

	// One stable handler per row, not one per chip, per the kit's `FilterChip` contract.
	const handleToggleLevel = useCallback((value?: string | number) => setLevels((current) => toggled(current, String(value))), []);

	const handleToggleRace = useCallback((value?: string | number) => setRaces((current) => toggled(current, String(value))), []);

	const handleToggleAttack = useCallback((value?: string | number) => setAttacks((current) => toggled(current, String(value))), []);

	const handleToggleDamage = useCallback((value?: string | number) => setDamages((current) => toggled(current, String(value))), []);

	const handleToggleMotion = useCallback((value?: string | number) => setMotions((current) => toggled(current, String(value))), []);

	const handleClearQuery = useCallback(() => setQuery(""), []);

	const handleToggleSortDirection = useCallback(() => setSortDescending((descending) => !descending), []);

	// A new key lands in the direction that key reads best in. Re-picking the key already in use is left alone.
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
		setLevels([]);
		setRaces([]);
		setAttacks([]);
		setDamages([]);
		setMotions([]);
		setQuery("");
	}, []);

	// Every active filter as one removable chip, each keeping its own delete handler so it clears only itself.
	const activeFilters = useMemo<ActiveFilter[]>(
		() => [
			...levels.map((level) => ({ id: `level-${level}`, label: level, onDelete: () => handleToggleLevel(level) })),
			...races.map((race) => ({ id: `race-${race}`, label: race, onDelete: () => handleToggleRace(race) })),
			...attacks.map((attack) => ({ id: `attack-${attack}`, label: attack, onDelete: () => handleToggleAttack(attack) })),
			...damages.map((damage) => ({ id: `damage-${damage}`, label: damage, onDelete: () => handleToggleDamage(damage) })),
			...motions.map((motion) => ({ id: `motion-${motion}`, label: motion, onDelete: () => handleToggleMotion(motion) })),
			...(query.trim() === "" ? [] : [{ id: "name", label: `"${query.trim()}"`, onDelete: handleClearQuery }])
		],
		[levels, races, attacks, damages, motions, query, handleToggleLevel, handleToggleRace, handleToggleAttack, handleToggleDamage, handleToggleMotion, handleClearQuery]
	);

	// Built once per filter change rather than per render, so a keystroke in the name search does not re-render every chip.
	const filterRows = useMemo(
		() => (
			<EnemyFilterRows
				levels={levels}
				onToggleLevel={handleToggleLevel}
				raceOptions={raceOptions}
				races={races}
				onToggleRace={handleToggleRace}
				attacks={attacks}
				onToggleAttack={handleToggleAttack}
				damages={damages}
				onToggleDamage={handleToggleDamage}
				motions={motions}
				onToggleMotion={handleToggleMotion}
			/>
		),
		[levels, raceOptions, races, attacks, damages, motions, handleToggleLevel, handleToggleRace, handleToggleAttack, handleToggleDamage, handleToggleMotion]
	);

	return (
		<Container component="main" maxWidth="lg" sx={{ py: 3 }}>
			<ScrollToTop />
			{error ? (
				<LoadError what="the enemy list" onRetry={handleRetry} />
			) : enemies === null ? (
				<Typography variant="body1" color="text.secondary" role="status">
					Loading...
				</Typography>
			) : (
				<>
					<FilterPanel activeCount={activeFilters.length} onClear={handleClearAll} nameQuery={query} onNameQueryChange={setQuery} nameLabel="Search enemies by name">
						{filterRows}
					</FilterPanel>
					<IndexSummaryBar
						rangeLabel={rangeLabel}
						total={sorted.length}
						activeFilters={activeFilters}
						sortId="enemy-sort"
						sortOptions={SORT_OPTIONS}
						sortKey={sortKey}
						onSortKeyChange={handleSortKeyChange}
						sortDescending={sortDescending}
						onToggleSortDirection={handleToggleSortDirection}
					/>
					<Box sx={{ pt: 3, pb: 6 }}>
						{sorted.length === 0 ? (
							<Typography variant="body1" color="text.secondary">
								No enemies match these filters. Try clearing one, or searching for a different name.
							</Typography>
						) : (
							<>
								<CardGrid items={visible} getKey={(enemy) => enemy.id} renderItem={(enemy) => <EnemyCard enemy={enemy} match={nameMatches.get(enemy.id) ?? null} />} size={CARD_SIZE} />
								{visible.length < sorted.length ? (
									<Box sx={{ display: "flex", justifyContent: "center", mt: 3 }}>
										<Button variant="outlined" onClick={handleLoadMore}>
											{`Load ${Math.min(PAGE_SIZE, sorted.length - visible.length)} more`}
										</Button>
									</Box>
								) : null}
							</>
						)}
					</Box>
				</>
			)}
		</Container>
	);
}
