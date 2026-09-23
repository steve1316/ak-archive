import { test } from "node:test";
import assert from "node:assert/strict";

import { RIG_BUCKET_COUNT, rigBucket, splitRigIndex } from "../lib/rigBuckets.mjs";

test("rigBucket takes the number in an operator or enemy id modulo the bucket count", () => {
	assert.equal(RIG_BUCKET_COUNT, 8);
	assert.equal(rigBucket("char_010_chen"), 2);
	assert.equal(rigBucket("char_1001_amiya2"), 1);
	assert.equal(rigBucket("enemy_1007_slime_2"), 7);
});

test("rigBucket puts every variant of an enemy group in the head's bucket", () => {
	assert.equal(rigBucket("enemy_1007_slime_3"), rigBucket("enemy_1007_slime"));
});

test("rigBucket puts an id with no number in the first bucket", () => {
	assert.equal(rigBucket("oddity"), 0);
});

test("splitRigIndex returns one object per bucket, each holding exactly the ids that bucket names", () => {
	const buckets = splitRigIndex({ char_010_chen: { a: 1 }, char_002_amiya: { b: 2 }, char_018_yato: { c: 3 } });
	assert.equal(buckets.length, 8);
	assert.deepEqual(buckets[2], { char_010_chen: { a: 1 }, char_002_amiya: { b: 2 }, char_018_yato: { c: 3 } });
	assert.deepEqual(buckets[0], {});
});
