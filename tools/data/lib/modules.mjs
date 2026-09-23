/**
 * Operator modules: each ADVANCED module in `uniequip_table`, with its three stages resolved from `battle_equip_table` into what the operator
 * page adds - flat stats, trait text, talent text and summon lines. Resolved here like skills, so the page only picks a stage and adds.
 */

import { asArray } from "./json.mjs";
import { keptTalentSlots, phaseOf } from "./operators.mjs";
import { resolveTemplate, stripMarkup } from "./text.mjs";

/** Module stat keys to the site's stat fields. `attack_speed` becomes `aspd`, which no base stat carries. */
const STAT_FIELDS = {
	max_hp: "maxHp",
	atk: "atk",
	def: "def",
	magic_resistance: "magicResistance",
	cost: "cost",
	block_cnt: "blockCnt",
	respawn_time: "respawnTime",
	attack_speed: "aspd"
};

/** Labels for a summon's stat changes. Summons carry two keys operators never do. */
const SUMMON_LABELS = {
	max_hp: "HP",
	atk: "ATK",
	def: "DEF",
	magic_resistance: "RES",
	cost: "Cost",
	block_cnt: "Block",
	respawn_time: "Redeploy",
	attack_speed: "ASPD",
	max_deck_stack_cnt: "Max held",
	max_deploy_count: "Max deployed"
};

/** The part targets whose trait candidates carry display text. At the pinned sha every stage takes its text from exactly one of them. */
const TRAIT_TARGETS = new Set(["TRAIT", "DISPLAY", "TRAIT_DATA_ONLY"]);

/**
 * Fill a template from its blackboard and strip its markup.
 *
 * @param {string} text The templated text.
 * @param {unknown} blackboard The candidate's blackboard.
 * @returns {string} Plain text.
 */
function resolveText(text, blackboard) {
	return stripMarkup(resolveTemplate(text, asArray(blackboard)));
}

/**
 * A signed number as the game prints a bonus.
 *
 * @param {number} value The value.
 * @returns {string} `+5`, or `-3` for a negative.
 */
function signed(value) {
	return value > 0 ? `+${value}` : String(value);
}

/**
 * A stage's flat stat bonus.
 *
 * @param {unknown} blackboard The stage's `attributeBlackboard`.
 * @returns {Record<string, number>} Non-zero bonuses by site stat field.
 * @throws When a key is not a known stat, which would mean a new module stat the page does not draw.
 */
export function moduleStats(blackboard) {
	const stats = {};
	for (const { key, value } of asArray(blackboard)) {
		const field = STAT_FIELDS[key];
		if (!field) {
			throw new Error(`unknown module stat ${key}`);
		}
		if (value !== 0) {
			stats[field] = value;
		}
	}
	return stats;
}

/**
 * A stage's trait change for the operator itself.
 *
 * @param {Array<object>} parts The stage's parts.
 * @returns {{mode: "append" | "replace", text: string} | null} The change, or null when the stage leaves the trait alone.
 * @throws When two parts carry different trait text, which the page could not show as one line.
 */
function buildTrait(parts) {
	const found = new Map();
	for (const part of parts) {
		if (part.isToken || !TRAIT_TARGETS.has(part.target)) {
			continue;
		}
		for (const candidate of asArray(part.overrideTraitDataBundle?.candidates)) {
			if (candidate.overrideDescripton) {
				const text = resolveText(candidate.overrideDescripton, candidate.blackboard);
				found.set(`replace|${text}`, { mode: "replace", text });
			} else if (candidate.additionalDescription) {
				const text = resolveText(candidate.additionalDescription, candidate.blackboard);
				found.set(`append|${text}`, { mode: "append", text });
			}
		}
	}
	if (found.size > 1) {
		throw new Error(`a module stage carries ${found.size} different trait texts`);
	}
	return [...found.values()][0] ?? null;
}

/**
 * A stage's talent changes for the operator itself, deduped. Upstream lists a few identical upgrades twice.
 *
 * @param {Array<object>} parts The stage's parts.
 * @param {number[]} kept The kept raw talent indexes, from `keptTalentSlots`.
 * @param {string[]} names Each kept talent's name, by position.
 * @returns {Array<{index: number | null, name: string, description: string, requiredPotential: number}>} The changes. `index` is null for a
 *   talent the module adds.
 */
function buildTalents(parts, kept, names) {
	const seen = new Set();
	const talents = [];
	for (const part of parts) {
		if (part.isToken) {
			continue;
		}
		for (const candidate of asArray(part.addOrOverrideTalentDataBundle?.candidates)) {
			if (candidate.isHideTalent || !candidate.upgradeDescription) {
				continue;
			}
			const slot = kept.indexOf(candidate.talentIndex);
			const index = slot === -1 ? null : slot;
			const name = stripMarkup(candidate.name ?? "") || (index === null ? "" : (names[index] ?? ""));
			const description = resolveText(candidate.upgradeDescription, candidate.blackboard);
			const requiredPotential = (candidate.requiredPotentialRank ?? 0) + 1;
			const key = `${index}|${requiredPotential}|${description}`;
			if (!seen.has(key)) {
				seen.add(key);
				talents.push({ index, name, description, requiredPotential });
			}
		}
	}
	return talents;
}

/**
 * A stage's effects on the operator's summons, as plain lines. Summons with the same stat change share one line.
 *
 * @param {object} phase The stage from `battle_equip_table`.
 * @param {Record<string, object>} characterTable For summon names.
 * @returns {string[]} The lines, deduped.
 * @throws When a summon stat key has no label.
 */
function buildSummon(phase, characterTable) {
	const lines = [];
	for (const part of asArray(phase.parts)) {
		if (!part.isToken) {
			continue;
		}
		for (const candidate of asArray(part.addOrOverrideTalentDataBundle?.candidates)) {
			if (candidate.isHideTalent || !candidate.upgradeDescription) {
				continue;
			}
			const text = resolveText(candidate.upgradeDescription, candidate.blackboard);
			const potential = candidate.requiredPotentialRank > 0 ? ` (P${candidate.requiredPotentialRank + 1})` : "";
			lines.push(`${candidate.name ? `${stripMarkup(candidate.name)}: ` : ""}${text}${potential}`);
		}
		for (const candidate of asArray(part.overrideTraitDataBundle?.candidates)) {
			const raw = candidate.overrideDescripton || candidate.additionalDescription;
			if (raw) {
				lines.push(resolveText(raw, candidate.blackboard));
			}
		}
	}
	const byEffect = new Map();
	for (const [tokenId, blackboard] of Object.entries(phase.tokenAttributeBlackboard ?? {})) {
		const effect = asArray(blackboard)
			.filter((entry) => entry.value !== 0)
			.map(({ key, value }) => {
				const label = SUMMON_LABELS[key];
				if (!label) {
					throw new Error(`unknown summon stat ${key}`);
				}
				return `${label} ${signed(value)}`;
			})
			.join(", ");
		if (effect) {
			const name = stripMarkup(characterTable[tokenId]?.name ?? tokenId);
			byEffect.set(effect, [...(byEffect.get(effect) ?? []), name]);
		}
	}
	for (const [effect, names] of byEffect) {
		lines.push(`${[...new Set(names)].join(", ")}: ${effect}`);
	}
	return [...new Set(lines)];
}

/**
 * Every ADVANCED module, grouped by operator id and in the game's order.
 *
 * @param {object} uniequip `uniequip_table`.
 * @returns {Map<string, Array<object>>} Raw module rows by operator id.
 */
export function indexModules(uniequip) {
	const byChar = new Map();
	for (const equip of Object.values(uniequip.equipDict ?? {})) {
		if (equip?.type === "ADVANCED") {
			byChar.set(equip.charId, [...(byChar.get(equip.charId) ?? []), equip]);
		}
	}
	for (const list of byChar.values()) {
		list.sort((a, b) => a.charEquipOrder - b.charEquipOrder);
	}
	return byChar;
}

/**
 * One operator's modules, resolved for the page.
 *
 * @param {object} row The operator's `character_table` row.
 * @param {Array<{candidates: Array<{name: string}>}>} talents The operator's built talents.
 * @param {Array<object>} equips The operator's raw module rows, from `indexModules`.
 * @param {Record<string, object>} battleEquip `battle_equip_table`.
 * @param {Record<string, object>} characterTable For summon names.
 * @returns {Array<object>} The modules, in the game's order.
 * @throws When a module has no battle entry or a new talent has no name.
 */
export function buildModules(row, talents, equips, battleEquip, characterTable) {
	const kept = keptTalentSlots(row);
	const names = talents.map((talent) => talent.candidates[0]?.name ?? "");
	return equips.map((equip) => {
		const battle = battleEquip[equip.uniEquipId];
		if (!battle) {
			throw new Error(`${equip.uniEquipId} has no battle_equip_table entry`);
		}
		const stages = asArray(battle.phases).map((phase) => {
			const parts = asArray(phase.parts);
			const stageTalents = buildTalents(parts, kept, names);
			if (stageTalents.some((talent) => !talent.name)) {
				throw new Error(`${equip.uniEquipId} adds a talent with no name`);
			}
			return { stats: moduleStats(phase.attributeBlackboard), trait: buildTrait(parts), talents: stageTalents, summon: buildSummon(phase, characterTable) };
		});
		return {
			id: equip.uniEquipId,
			name: stripMarkup(equip.uniEquipName),
			code: `${equip.typeName1}-${equip.typeName2}`,
			typeIcon: equip.typeIcon.toLowerCase(),
			art: equip.uniEquipIcon.toLowerCase(),
			unlockPhase: phaseOf(equip.unlockEvolvePhase),
			unlockLevel: equip.unlockLevel,
			stages
		};
	});
}

/**
 * One operator's module lore, for the profile side file.
 *
 * @param {Array<object>} equips The operator's raw module rows.
 * @returns {Record<string, string>} Lore by module id. Empty when the operator has no modules.
 */
export function buildModuleLore(equips) {
	return Object.fromEntries(equips.map((equip) => [equip.uniEquipId, stripMarkup(equip.uniEquipDesc)]).filter(([, text]) => text));
}
