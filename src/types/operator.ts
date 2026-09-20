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
	/** Talents, each with its candidates. */
	talents: Talent[];
	/** Potential ranks 2 through 6. */
	potentials: PotentialRank[];
	/** The stat block. */
	stats: OperatorStats;
}

/** One handbook section, such as Basic Info or Profile. */
export interface LoreSection {
	/** The section heading. */
	title: string;
	/** The section body, with line breaks kept. */
	text: string;
}

/** One RIIC base skill, as `building_data` describes it. */
export interface BaseSkill {
	/** Upstream buff id. */
	id: string;
	/** The skill's name. */
	name: string;
	/** Which base room it applies in, such as `TRADING`. */
	room: string;
	/** What it does, with markup stripped. */
	description: string;
	/** The 0-based elite phase that unlocks it. */
	phase: number;
	/** The level within `phase` that unlocks it. */
	level: number;
}

/** An operator's heavy side data, loaded only by the operator page. */
export interface Profile {
	/** Handbook sections, in the game's order. */
	lore: LoreSection[];
	/** RIIC base skills. */
	baseSkills: BaseSkill[];
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
 * The operator page's four control values. The stats, talents and skins panels all read the same four, so the page owns them in one place and
 * passes them down, rather than each panel keeping its own copy.
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
}
