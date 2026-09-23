// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Story data

/** Types for the generated story data under `src/data/story/` and the story asset manifest `src/data/story-assets.json`. */

/** One styled run of a line's text. */
export interface Span {
	/** The run's text. */
	text: string;
	/** Present when the run is italic. */
	i?: true;
	/** Present when the run is bold. */
	b?: true;
	/** The run's colour as the script writes it, such as `#ff6237`. */
	color?: string;
}

/** A spoken or narrated line. */
export interface LineStep {
	/** The step type. */
	t: "line";
	/** Who speaks, or null for narration. */
	name: string | null;
	/** The plain text. `{@nickname}` stands for the reader's name. */
	text: string;
	/** Styled runs of `text`, present only when some of it is styled. */
	spans?: Span[];
	/** Present when this line continues the previous speaker's box. */
	append?: true;
	/** Present when this line closes its box, so the next continued line starts a new one. */
	end?: true;
}

/** A stage direction. `unknown` marks a command the parser does not know, which the player skips. */
export interface CommandStep {
	/** The step type. */
	t: "cmd" | "unknown";
	/** The command name, lowercased. */
	c: string;
	/** The command's arguments, keys lowercased. */
	a: Record<string, unknown>;
}

/** A choice the reader makes. */
export interface DecisionStep {
	/** The step type. */
	t: "decision";
	/** The option texts, in order. */
	options: string[];
	/** The value each option sets, paired with `options`. */
	values: string[];
}

/** A filter on the steps that follow, up to the next predicate. */
export interface PredicateStep {
	/** The step type. */
	t: "predicate";
	/** The picked values that show what follows, or null to rejoin every branch. */
	refs: string[] | null;
}

/** One step of a story. */
export type Step = LineStep | CommandStep | DecisionStep | PredicateStep;

/** One story's file. */
export interface StoryFile {
	/** The story id. */
	id: string;
	/** Its steps, in script order. */
	steps: Step[];
}

/** One story in a group's list. */
export interface StoryGroupEntry {
	/** The story id. */
	id: string;
	/** The stage code, such as `0-1`, or null. */
	code: string | null;
	/** The story's title. */
	name: string;
	/** Where it plays, such as `Before Operation`. */
	tag: string;
}

/** One episode, event, side story or record set, with its stories. */
export interface StoryGroup {
	/** The group id, such as `main_0`. */
	id: string;
	/** The group's name. */
	name: string;
	/** Which picker tab it belongs to. */
	type: "main" | "event" | "side" | "record";
	/** Its stories, in order. */
	stories: StoryGroupEntry[];
}

/** A group's entry in a picker tab. */
export interface StoryGroupMeta {
	/** The group id. */
	id: string;
	/** The group's name. */
	name: string;
	/** How many stories it holds. */
	stories: number;
	/** The upstream cover id for events and side stories, or null. */
	cover: string | null;
	/** When it first showed in game, as Unix seconds, or null. */
	start: number | null;
}

/** The story index the picker reads. */
export interface StoryIndex {
	/** The main story's acts, each listing its episode ids. */
	acts: { id: string; name: string; groups: string[] }[];
	/** Main episodes in order. */
	main: StoryGroupMeta[];
	/** Events by start time. */
	events: StoryGroupMeta[];
	/** Side stories by start time. */
	side: StoryGroupMeta[];
	/** Operators with record stories, and their sets. */
	records: { operator: string; sets: { group: string; name: string }[] }[];
	/** Script paths the upstream data names but does not have. */
	missing: string[];
}

/** The story asset manifest: which keys are published, by kind, and which references the mirror lacks. */
export interface StoryAssets {
	/** Published background keys. */
	backgrounds: string[];
	/** Published art scene keys. */
	images: string[];
	/** Published item keys. */
	items: string[];
	/** Published sprite keys. */
	sprites: string[];
	/** Published audio keys, each a lowercased reference. */
	audio: string[];
	/** Group ids with a published cover. */
	covers: string[];
	/** Group ids with published map art. */
	maps: string[];
	/** References the mirror does not have, by kind. */
	unavailable: Record<string, string[]>;
}
