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

test("the story steps wait for a first publish, never block the core refresh, publish before the check and claim only what they published", () => {
	const build = WORKFLOW.indexOf("- name: Plan, fetch and build new story assets");
	const publish = WORKFLOW.indexOf("- name: Publish new story assets");
	const manifest = WORKFLOW.indexOf("story_assets.py manifest");
	const check = WORKFLOW.indexOf("- name: Check the data");
	const commit = WORKFLOW.indexOf("- name: Commit the refreshed data");
	assert.ok(build !== -1 && build < publish && publish < manifest && manifest < check && check < commit, "story build, then publish, then manifest, all before the check and the commit");
	const buildStep = WORKFLOW.slice(build, publish);
	const publishStep = WORKFLOW.slice(publish, WORKFLOW.indexOf("- name:", publish + 10));
	assert.match(buildStep, /hashFiles\('src\/data\/story-assets\.json'\) != ''/, "no story work until the first publish's manifest is committed");
	assert.match(buildStep, /continue-on-error: true/);
	assert.match(buildStep, /story_assets\.py plan --staging "\$S2" --max-files "\$MAX_FILES"/);
	assert.match(publishStep, /continue-on-error: true/);
	assert.match(publishStep, /steps\.story_build\.outcome == 'success'/);
	assert.match(WORKFLOW.slice(check, commit), /CHECK_STORY_GAPS: warn/);
	assert.match(WORKFLOW, /STORY_ASSETS_DEPLOY_KEY/);
	assert.match(WORKFLOW, /--remote git@github\.com:steve1316\/ak-archive-story\.git/);
});
