// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Story engine coverage audit

/**
 * Compares the commands and arguments in every parsed story against what the story engine reads. The engine is read as text, so the result is
 * a close estimate and not a proof. Run it as `node tools/story/audit_coverage.mjs` to print the gaps by how often they occur, or with
 * `--write` to refresh `tools/story/engine-coverage.json`, which the coverage test compares against.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ENGINE = path.join(ROOT, "src/pages/story/engine.ts");
const STORIES = path.join(ROOT, "src/data/story/stories");
export const SNAPSHOT = path.join(ROOT, "tools/story/engine-coverage.json");

/** Commands the engine acts on outside `applyCommand`, so they have no case there. */
const OUTSIDE_APPLY = new Set(["delay", "header"]);

/**
 * Splits the engine source into its top-level function bodies by name.
 *
 * @param {string} source The engine source.
 * @returns {Map<string, string>} Function name to its text.
 */
function functionsOf(source) {
	const found = new Map();
	for (const m of source.matchAll(/\n(?:export )?function (\w+)\(/g)) {
		const start = m.index + m[0].length;
		const next = source.slice(start).search(/\n(?:export )?(?:function |const |interface |type )/);
		found.set(m[1], source.slice(m.index, next < 0 ? source.length : start + next));
	}
	return found;
}

/**
 * Finds the argument keys a piece of engine code reads, following calls to other engine functions.
 *
 * @param {string} text The code.
 * @param {Map<string, string>} funcs The engine functions by name.
 * @param {Set<string>} seen Functions already followed.
 * @returns {Set<string>} The keys read.
 */
function keysRead(text, funcs, seen = new Set()) {
	const keys = new Set();
	for (const m of text.matchAll(/\b(?:a|args)\.(\w+)|"(\w+)" in a\b|\ba\["(\w+)"\]/g)) {
		keys.add(m[1] ?? m[2] ?? m[3]);
	}
	for (const m of text.matchAll(/\b(\w+)\(/g)) {
		const fn = m[1];
		if (funcs.has(fn) && fn !== "applyCommand" && !seen.has(fn)) {
			seen.add(fn);
			keysRead(funcs.get(fn), funcs, seen).forEach((k) => keys.add(k));
		}
	}
	// Keys the engine lists as strings, such as the charslot modifiers, count as looked at but not applied, so they are left out here.
	return keys;
}

/**
 * Audits the stories against the engine.
 *
 * @returns {{ commands: Record<string, { count: number, handled: boolean, ignored: Record<string, number> }> }} Per command, how often it
 * occurs, whether the engine handles it and the arguments it never reads with how often each occurs.
 */
export function auditCoverage() {
	const source = fs.readFileSync(ENGINE, "utf8");
	const funcs = functionsOf(source);
	const applyText = funcs.get("applyCommand") ?? "";
	const cases = new Map();
	let pending = [];
	const parts = applyText.split(/\n\t\tcase "(\w+)":/);
	for (let i = 1; i < parts.length; i += 2) {
		pending.push(parts[i]);
		if (parts[i + 1].trim()) {
			pending.forEach((name) => cases.set(name, parts[i + 1]));
			pending = [];
		}
	}
	const waitKeys = new Set([...keysRead(funcs.get("waitOf") ?? "", funcs), ...keysRead(funcs.get("timeOf") ?? "", funcs)]);
	const commands = {};
	for (const file of fs.readdirSync(STORIES)) {
		for (const step of JSON.parse(fs.readFileSync(path.join(STORIES, file), "utf8")).steps) {
			if (step.t !== "cmd") {
				continue;
			}
			const entry = (commands[step.c] ??= { count: 0, handled: cases.has(step.c) || OUTSIDE_APPLY.has(step.c), ignored: {} });
			entry.count++;
			const read = cases.has(step.c) ? new Set([...keysRead(cases.get(step.c), funcs), ...waitKeys]) : new Set();
			for (const key of Object.keys(step.a)) {
				if (!read.has(key) && !OUTSIDE_APPLY.has(step.c)) {
					entry.ignored[key] = (entry.ignored[key] ?? 0) + 1;
				}
			}
		}
	}
	return { commands };
}

/**
 * The reviewed-gap list stored in the snapshot: the names only, so a data refresh that changes counts does not change it.
 *
 * @param {ReturnType<typeof auditCoverage>} audit The audit.
 * @returns {Record<string, { handled: boolean, ignored: string[] }>} Per command, whether it is handled and the sorted ignored keys.
 */
export function namesOf(audit) {
	return Object.fromEntries(
		Object.keys(audit.commands)
			.sort()
			.map((c) => [c, { handled: audit.commands[c].handled, ignored: Object.keys(audit.commands[c].ignored).sort() }])
	);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const audit = auditCoverage();
	if (process.argv.includes("--write")) {
		fs.writeFileSync(SNAPSHOT, JSON.stringify(namesOf(audit), null, "\t") + "\n");
		console.log(`wrote ${path.relative(ROOT, SNAPSHOT)}`);
	} else {
		const rows = Object.entries(audit.commands).flatMap(([c, e]) => (e.handled ? Object.entries(e.ignored).map(([k, n]) => [n, `${c}.${k}`]) : [[e.count, `${c} (whole command)`]]));
		rows.sort((x, y) => y[0] - x[0]).forEach(([n, name]) => console.log(String(n).padStart(7), name));
	}
}
