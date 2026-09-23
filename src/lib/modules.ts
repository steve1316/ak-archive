// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Module effects

/**
 * What the selected module changes on the operator page. One `ModuleEffect` is derived per render in `operator.tsx` and read by the Stats card,
 * the trait block and the Abilities card, so none of them repeats the rules. Only type imports here, so a scratch script can run it directly.
 */

import type { Controls, ModuleStage, ModuleStats, OperatorFull, OperatorModule, StatValues, Talent, TalentCandidate } from "../types/operator.js";

/** A talent as the page shows it, with a note naming the module stage that changed it. */
export interface EffectiveTalent {
	/** The talent, with the module's versions appended to its candidates when a module changes it. */
	talent: Talent;
	/** Such as `SWO-X Stage 3`, or null when no module touches this talent. */
	moduleNote: string | null;
}

/** The trait as the page shows it. */
export interface EffectiveTrait {
	/** The operator's own trait, or null when a module replaces it. */
	base: string | null;
	/** The module's text, appended to `base` or standing in for it, or null when no module changes the trait. */
	extra: string | null;
}

/** Everything the selected module changes, at the current controls. */
export interface ModuleEffect {
	/** The applied module, or null when none is selected or it is not unlocked. */
	module: OperatorModule | null;
	/** The applied stage, or null alongside `module`. */
	stage: ModuleStage | null;
	/** The trait to show. */
	trait: EffectiveTrait;
	/** Every talent to show, in order, including any the module adds. */
	talents: EffectiveTalent[];
}

/**
 * Whether a module works at a phase and level.
 *
 * @param module The module.
 * @param phase The 0-based elite phase.
 * @param level The level within that phase.
 * @returns True at or past the module's unlock phase and level.
 */
export function isModuleUnlocked(module: OperatorModule, phase: number, level: number): boolean {
	return phase > module.unlockPhase || (phase === module.unlockPhase && level >= module.unlockLevel);
}

/**
 * Apply a control change the way the page does. A phase change moves the level to that phase's max. Picking a module below its unlock point
 * jumps to that point's phase at max level, so the numbers are ones the game allows. Any other change that leaves the unlock point clears
 * the module rather than showing stats the game never allows.
 *
 * @param operator The operator, with its details.
 * @param current The controls before the change.
 * @param patch The changed fields.
 * @returns The controls after the change.
 */
export function applyControlsPatch(operator: OperatorFull, current: Controls, patch: Partial<Controls>): Controls {
	const next = { ...current, ...patch };
	if (patch.phase !== undefined && patch.phase !== current.phase) {
		next.level = operator.stats.phases[next.phase]?.maxLevel ?? next.level;
	}
	const module = operator.modules.find((entry) => entry.id === next.module);
	if (module && !isModuleUnlocked(module, next.phase, next.level)) {
		if (patch.module !== undefined && patch.module !== current.module) {
			next.phase = module.unlockPhase;
			next.level = operator.stats.phases[module.unlockPhase]?.maxLevel ?? next.level;
		} else {
			next.module = null;
		}
	}
	return next;
}

/**
 * The selected module's effect at the current controls. Talent upgrades are appended as extra candidates gated at the module's unlock point, so
 * the existing candidate picker chooses them and the base candidate stays the highlighting baseline.
 *
 * @param operator The operator, with its details.
 * @param controls The page's controls.
 * @returns The effect. With no applied module it is the operator unchanged.
 */
export function applyModule(operator: OperatorFull, controls: Controls): ModuleEffect {
	const selected = controls.module === null ? null : (operator.modules.find((entry) => entry.id === controls.module) ?? null);
	const module = selected && isModuleUnlocked(selected, controls.phase, controls.level) ? selected : null;
	const stage = module?.stages[controls.moduleStage - 1] ?? null;
	if (!module || !stage) {
		return { module: null, stage: null, trait: { base: operator.description, extra: null }, talents: operator.talents.map((talent) => ({ talent, moduleNote: null })) };
	}

	const note = `${module.code} Stage ${controls.moduleStage}`;
	const toCandidate = (entry: { name: string; description: string; requiredPotential: number }): TalentCandidate => ({
		name: entry.name,
		description: entry.description,
		unlockPhase: module.unlockPhase,
		unlockLevel: module.unlockLevel,
		requiredPotential: entry.requiredPotential
	});
	const talents: EffectiveTalent[] = operator.talents.map((talent, index) => {
		const upgrades = stage.talents.filter((entry) => entry.index === index);
		return upgrades.length > 0 ? { talent: { candidates: [...talent.candidates, ...upgrades.map(toCandidate)] }, moduleNote: note } : { talent, moduleNote: null };
	});
	const added = new Map<string, TalentCandidate[]>();
	for (const entry of stage.talents.filter((talent) => talent.index === null)) {
		added.set(entry.name, [...(added.get(entry.name) ?? []), toCandidate(entry)]);
	}
	for (const candidates of added.values()) {
		talents.push({ talent: { candidates }, moduleNote: note });
	}

	const trait: EffectiveTrait =
		stage.trait === null
			? { base: operator.description, extra: null }
			: stage.trait.mode === "append"
				? { base: operator.description, extra: stage.trait.text }
				: { base: null, extra: stage.trait.text };
	return { module, stage, trait, talents };
}

/**
 * Stats with a module stage's bonus added on top of trust and potential. ASPD shortens the attack interval the way the game does.
 *
 * @param stats The stats from `statsAt`.
 * @param stage The applied stage, or null for none.
 * @returns The stats with the bonus, the interval rounded to two decimals like `statsAt`.
 */
export function withModuleStats(stats: StatValues, stage: ModuleStage | null): StatValues {
	if (!stage) {
		return stats;
	}
	const out = { ...stats };
	for (const [field, value] of Object.entries(stage.stats) as [keyof ModuleStats, number][]) {
		if (field !== "aspd") {
			out[field] += value;
		}
	}
	if (stage.stats.aspd) {
		out.baseAttackTime = Math.round(((stats.baseAttackTime * 100) / (100 + stage.stats.aspd)) * 100) / 100;
	}
	return out;
}
