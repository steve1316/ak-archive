import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/** The refresh workflow, read once. */
const WORKFLOW = fs.readFileSync(".github/workflows/refresh.yml", "utf8");

test("the refresh job keeps the workflow token out of its job-wide env", () => {
	const jobEnv = /\n {2}refresh:\n[\s\S]*?\n {4}env:\n((?: {6}.*\n)+)/.exec(WORKFLOW)?.[1] ?? "";
	assert.doesNotMatch(jobEnv, /github\.token/);
});

test("the gap grace period is checked after the deploy, not before the commit", () => {
	const steps = [...WORKFLOW.matchAll(/\n {6}- name: (.+)/g)].map((match) => match[1]);
	assert.ok(steps.indexOf("Check the gap grace period") > steps.indexOf("Deploy"));
	assert.match(WORKFLOW, /- name: Check the data\n {8}env:\n {10}CHECK_GAP_GRACE: "off"/);
});

test("the refresh job restores the story script cache and passes a token to the import that lists the scripts", () => {
	const cache = WORKFLOW.indexOf("path: tools/data/.cache/story");
	const importStep = WORKFLOW.indexOf("- name: Import game data");
	const importRun = WORKFLOW.indexOf("run: pnpm run import");
	assert.ok(cache !== -1 && cache < importStep, "a cache step for tools/data/.cache/story must come before the import");
	const importBlock = WORKFLOW.slice(importStep, importRun);
	assert.match(importBlock, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
});

test("the refresh plans and builds story assets before the check, and publishes them with their own deploy key before the commit", () => {
	const plan = WORKFLOW.indexOf("story_assets.py plan");
	const manifest = WORKFLOW.indexOf("story_assets.py manifest");
	const check = WORKFLOW.indexOf("- name: Check the data");
	const publish = WORKFLOW.indexOf("story_publish.py add --confirm");
	const commit = WORKFLOW.indexOf("- name: Commit the refreshed data");
	assert.ok(plan !== -1 && plan < manifest && manifest < check, "story plan and manifest must run before the check");
	assert.ok(publish !== -1 && check < publish && publish < commit, "story publish must run after the check and before the commit");
	assert.match(WORKFLOW, /STORY_ASSETS_DEPLOY_KEY/);
	assert.match(WORKFLOW, /--remote git@github\.com:steve1316\/ak-archive-story\.git/);
});
