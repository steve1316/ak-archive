// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Operator data

/** One set of stat values, in the order a stats panel reads them. */
export interface StatValues {
	/** Maximum hit points. */
	maxHp: number;
	/** Attack power. */
	atk: number;
	/** Physical defence. */
	def: number;
	/** Arts resistance, as a percentage. */
	magicResistance: number;
	/** Deployment cost in DP. */
	cost: number;
	/** How many enemies the operator blocks. */
	blockCnt: number;
	/** Seconds between attacks. */
	baseAttackTime: number;
	/** Seconds before the operator can be redeployed. */
	respawnTime: number;
}

/** One elite phase, carrying only its two ends because the game ships two keyframes and everything between is interpolated. */
export interface StatPhase {
	/** The highest level this phase reaches. */
	maxLevel: number;
	/** This phase's attack range, a key into `src/data/ranges.json`. */
	rangeId: string;
	/** Stats at level 1 of this phase, without trust. */
	min: StatValues;
	/** Stats at `maxLevel` of this phase, without trust. */
	max: StatValues;
}

/**
 * What full trust adds, which is only ever these four stats.
 *
 * `tools/data/lib/stats.mjs` builds it from a fixed `TRUST_FIELDS` list and fills every one, defaulting an untouched stat to 0, so all four are
 * always present and no other stat ever appears. Typing it `Partial<StatValues>` would be wrong twice over: it would admit fields that can never
 * occur, and it would mark as possibly-undefined four values the importer guarantees.
 */
export type TrustBonus = Pick<StatValues, "maxHp" | "atk" | "def" | "magicResistance">;

/** An operator's full stat block, as the importer writes it. */
export interface OperatorStats {
	/** One entry per elite phase, in order. */
	phases: StatPhase[];
	/** Final phase at max level with full trust and potential 1, which is what a wiki prints. */
	trusted: StatValues;
	/** What full trust adds on top of a phase's untrusted numbers. Per-stat and irregular, so it is not a flat percentage. */
	trustBonus: TrustBonus;
}

/** One version of a talent, gated by elite phase, level and potential. */
export interface TalentCandidate {
	/** The talent's name at this rank. */
	name: string;
	/** The talent's effect, with markup stripped. */
	description: string;
	/** The 0-based elite phase that unlocks this candidate. */
	unlockPhase: number;
	/** The level within `unlockPhase` that unlocks this candidate. */
	unlockLevel: number;
	/** The 1-based potential rank this candidate needs. */
	requiredPotential: number;
}

/** One talent, which is a set of candidates rather than a single description. */
export interface Talent {
	/** Every candidate the game can show, in the order upstream lists them. */
	candidates: TalentCandidate[];
}

/** One potential rank, 2 through 6. */
export interface PotentialRank {
	/** The 1-based rank, 2 to 6. Rank 1 is the operator as recruited and has no entry. */
	rank: number;
	/** `BUFF` carries stat modifiers, `CUSTOM` only improves a talent. */
	type: "BUFF" | "CUSTOM";
	/** What the game says this rank does. */
	description: string;
	/** Stat changes this rank applies. Empty for a `CUSTOM` rank. */
	modifiers: Partial<StatValues>;
}

/** One costume the operator can be shown in, as the importer reads it from `skin_table`. */
export interface OperatorFormEntry {
	/** Variant key in the art pipeline's spelling, such as `2` or `summer_4`. `1` is the base art. */
	key: string;
	/** What the form's chip reads: `Base`, `Elite 1`, `Elite 2`, or the skin's name. */
	name: string;
	/** An outfit's Global release day as `YYYY-MM-DD`. Null for Base and Elite art, which arrive with the operator. */
	releaseDate: string | null;
}

/** One run of a skill description: plain text, or a value upstream marks as raised or lowered. */
export interface SkillRun {
	/** The run's text, with line breaks kept. */
	text: string;
	/** `"up"` for a raised value, `"down"` for a lowered one, null for plain text. */
	emphasis: "up" | "down" | null;
}

/** A skill at one level. */
export interface SkillLevel {
	/** The skill's name at this level. */
	name: string;
	/** The description, resolved into runs. */
	description: SkillRun[];
	/** How the skill fires. */
	trigger: "auto" | "manual" | "passive";
	/** How SP comes back, or null for a skill with no SP. */
	recovery: "auto" | "offensive" | "defensive" | null;
	/** SP needed to fire. */
	spCost: number;
	/** SP at the start of a battle. */
	initialSp: number;
	/** Seconds the skill lasts, or 0 for an instant, toggled or ammo skill. */
	duration: number;
	/** The range while this skill level is active, a key into `src/data/ranges.json`, or null when it keeps the operator's normal range. */
	rangeId: string | null;
	/** Tiles this level stretches the normal range forward, negative when it shortens it. Absent when the skill does not change the normal range. */
	rangeExtend?: number;
}

/** One of an operator's combat skills. */
export interface OperatorSkill {
	/** Upstream skill id, such as `skchr_svrash_3`. */
	id: string;
	/** The published icon key, from `iconKey` in `tools/data/lib/skills.mjs`. */
	icon: string;
	/** The 0-based elite phase that unlocks this skill slot. */
	unlockPhase: number;
	/** One entry per level: 7 for a skill with no masteries, 10 (1-7, then M1-M3) otherwise. */
	levels: SkillLevel[];
}

/** A module's flat stat bonus at one stage. `aspd` is attack speed, which no base stat carries. */
export type ModuleStats = Partial<StatValues> & {
	/** Attack speed added, in the game's ASPD points. */
	aspd?: number;
};

/** A module stage's change to the operator's trait. */
export interface ModuleTrait {
	/** `append` adds the text after the base trait, `replace` shows it instead. */
	mode: "append" | "replace";
	/** The trait text, with markup stripped and values filled in. */
	text: string;
}

/** One talent change a module stage makes. */
export interface ModuleTalent {
	/** The position in `Operator.talents` it upgrades, or null for a talent only the module grants. */
	index: number | null;
	/** The talent's name. */
	name: string;
	/** The talent's effect at this stage and potential. */
	description: string;
	/** The 1-based potential rank this version needs. */
	requiredPotential: number;
}

/** One of a module's three stages. */
export interface ModuleStage {
	/** Flat stats the stage adds. */
	stats: ModuleStats;
	/** The trait change, or null when the stage leaves the trait alone. */
	trait: ModuleTrait | null;
	/** Talent changes, in upstream order. */
	talents: ModuleTalent[];
	/** Effects on the operator's summons, as plain lines. */
	summon: string[];
}

/** One module an operator can equip. */
export interface OperatorModule {
	/** The upstream id, such as `uniequip_002_chen`. */
	id: string;
	/** The module's name. */
	name: string;
	/** The branch code the game shows, such as `SWO-X`. */
	code: string;
	/** The lowercase key of the branch badge on the asset host, such as `swo-x`. */
	typeIcon: string;
	/** The lowercase key of the module picture on the asset host, such as `uniequip_002_chen`. */
	art: string;
	/** The 0-based elite phase the module unlocks at. */
	unlockPhase: number;
	/** The level within `unlockPhase` the module unlocks at. */
	unlockLevel: number;
	/** Stages 1 to 3, in order. */
	stages: ModuleStage[];
}

/** One operator, as a class shard holds it. */
export interface Operator {
	/** Upstream id, such as `char_002_amiya`. */
	id: string;
	/** Display name. */
	name: string;
	/** Star count, 1 to 6. */
	rarity: number;
	/** Display class name, such as `Guard`. */
	profession: string;
	/** Upstream class key, such as `WARRIOR`. */
	professionKey: string;
	/** Display archetype name, such as `Core Caster`. */
	subProfession: string;
	/** Upstream archetype key, such as `corecaster`. */
	subProfessionKey: string;
	/** Deployment position, such as `Ranged`. */
	position: string;
	/** Recruitment tags. Blank entries are dropped at import. */
	tags: string[];
	/** Home nation, or null when the operator has none. */
	nation: string | null;
	/** Organisation, or null. */
	group: string | null;
	/** Squad, or null. */
	team: string | null;
	/** The operator's trait, resolved and stripped, or null. */
	description: string | null;
	/** The trait's secondary area, such as the Spreadshooter 160% row, a key into `src/data/ranges.json`, or null when the trait has none. */
	traitRangeId: string | null;
	/** Talents, each with its candidates. */
	talents: Talent[];
	/** Potential ranks 2 through 6. */
	potentials: PotentialRank[];
	/** The stat block. */
	stats: OperatorStats;
	/** Every costume upstream lists for this operator, in display order. The site keeps only those with published art. */
	forms: OperatorFormEntry[];
	/** Global release day as `YYYY-MM-DD`, from `tools/data/release-dates.json`, or null when unknown. */
	releaseDate: string | null;
}

/** The operator page's own data: skills and handbook record, kept out of the index shard the operator page never draws. */
export interface OperatorDetails {
	/** Combat skills in slot order. Empty for the operators that have none. */
	skills: OperatorSkill[];
	/** The operator's modules, in the game's order. Empty for operators without any. */
	modules: OperatorModule[];
	/** The handbook's Basic Info and Physical Exam, parsed. Those two sections are not in the lore. */
	record: HandbookRecord;
}

/** An operator plus its details, which is what the operator page renders. */
export type OperatorFull = Operator & OperatorDetails;

/** One handbook section, such as Basic Info or Profile. */
export interface LoreSection {
	/** The section heading. */
	title: string;
	/** The section body, with line breaks kept. */
	text: string;
}

/** One field of the handbook's bracketed record, such as `[Height] 192cm`. */
export interface RecordField {
	/** The label, verbatim from upstream, such as `Height` or `Place of Production`. Robots and a few operators use their own. */
	label: string;
	/** The value, with any continuation lines joined by a space. Can be a redaction of block characters, or a whole paragraph. */
	value: string;
	/** Position on the physical exam scale, 1 (Feeble) to 7 (Exceptional), or null when the value is not a single grade. */
	grade: number | null;
}

/** The parts of the handbook that are a record of fields rather than prose. */
export interface HandbookRecord {
	/** The Basic Info fields, in upstream order. Empty when the operator has no parseable Basic Info. */
	basic: RecordField[];
	/** The Physical Exam fields, in upstream order. */
	exam: RecordField[];
}

/** An operator's handbook prose, the one thing still loaded on demand. */
export interface Profile {
	/** Handbook sections, in the game's order. */
	lore: LoreSection[];
	/** Each module's story text, by module id. Absent for operators without modules. */
	moduleLore?: Record<string, string>;
}

/** One entry in the navbar's search index. Deliberately tiny - it renders on every route. */
export interface SearchEntry {
	/** Upstream id. */
	id: string;
	/** Display name. */
	name: string;
	/** Star count, 1 to 6. */
	rarity: number;
	/** Display class name, which is also how the app finds the right shard. */
	profession: string;
}

/**
 * The operator page's six control values. The Stats and Abilities cards both read the same six, so the page owns them in one place and
 * passes them down, rather than each card keeping its own copy.
 */
export interface Controls {
	/** 0-based elite phase index. */
	phase: number;
	/** Selected level within `phase`. */
	level: number;
	/** Whether full trust bonuses are applied. */
	trust: boolean;
	/** Selected potential rank, 1 to 6. */
	potential: number;
	/** The selected module's id, or null for no module. */
	module: string | null;
	/** The selected module stage, 1 to 3. */
	moduleStage: number;
}

/** Where the site's data was pulled from, written by `tools/data/import.mjs` to `src/data/upstream.json`. */
export interface UpstreamInfo {
	/** The upstream repo this site's data was imported from, as `owner/name`. */
	repo: string;
	/** Which game server's tables were imported, such as `en`. */
	server: string;
	/** The commit sha the import is pinned to, in full. The home page shows only the first ten characters of it. */
	sha: string;
	/** How many operators the import produced. */
	operators: number;
	/** How many enemy variants the import produced. */
	enemies: number;
}
