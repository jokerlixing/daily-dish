import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {slots, limit, cleanPlan, addToPlan, moveInPlan, removeFromPlan} = require('../src/today-plan.js');
const validIds = new Set(['egg', 'rice', 'soup', 'toString', '__proto__']);

test('today plan is available to both the browser and Node with four supported areas', () => {
  const browser = {window: {}};
  vm.runInNewContext(fs.readFileSync(new URL('../src/today-plan.js', import.meta.url), 'utf8'), browser);
  assert.equal(typeof browser.window.TodayPlanCore.cleanPlan, 'function');
  assert.deepEqual(slots, ['lobby', 'breakfast', 'lunch', 'dinner']);
  assert.equal(limit, 1000);
  assert.ok(Object.isFrozen(slots));
});

test('stored plans reject malformed entries and unknown recipes while defaulting invalid areas to the lobby', () => {
  const input = [null, 1, 'egg', [], {id: 4}, {id: ''}, {id: 'missing'},
    Object.create({id: 'egg'}), {id: 'egg'}, {id: 'rice', slot: 'unknown', extra: true},
    {id: 'soup', slot: 'dinner'}];
  assert.deepEqual(cleanPlan(input, validIds), [
    {id: 'egg', slot: 'lobby'}, {id: 'rice', slot: 'lobby'}, {id: 'soup', slot: 'dinner'}
  ]);
  for (const invalid of [null, undefined, {}, 'egg', 42]) assert.deepEqual(cleanPlan(invalid, validIds), []);
  for (const invalid of [null, undefined, {}, {egg: true}, 'egg']) {
    assert.deepEqual(cleanPlan([{id: 'egg'}], invalid), []);
  }
  assert.deepEqual(cleanPlan([{id: 'egg'}], ['egg']), [{id: 'egg', slot: 'lobby'}]);
});

test('recipe migrations deduplicate canonical IDs and preserve the first meal assignment', () => {
  const aliases = {'old-rice': 'rice', 'removed': 'missing', 'bad-alias': 1};
  const input = [
    {id: 'old-rice', slot: 'lunch'}, {id: 'rice', slot: 'dinner'},
    {id: 'egg', slot: 'breakfast'}, {id: 'egg', slot: 'lobby'},
    {id: 'removed', slot: 'dinner'}, {id: 'bad-alias'}
  ];
  assert.deepEqual(cleanPlan(input, validIds, aliases), [
    {id: 'rice', slot: 'lunch'}, {id: 'egg', slot: 'breakfast'}
  ]);
});

test('inherited alias properties cannot remap recipe IDs', () => {
  const aliases = Object.create({'egg': 'rice', 'toString': 'rice'});
  aliases.legacy = 'soup';
  assert.deepEqual(cleanPlan([
    {id: 'egg'}, {id: 'toString'}, {id: '__proto__'}, {id: 'legacy'}
  ], validIds, aliases), [
    {id: 'egg', slot: 'lobby'}, {id: 'toString', slot: 'lobby'},
    {id: '__proto__', slot: 'lobby'}, {id: 'soup', slot: 'lobby'}
  ]);
  assert.deepEqual(cleanPlan([{id: 'egg'}], validIds, null), [{id: 'egg', slot: 'lobby'}]);
  const ownAlias = JSON.parse('{"__proto__":"rice"}');
  assert.deepEqual(cleanPlan([{id: '__proto__'}], validIds, ownAlias), [{id: 'rice', slot: 'lobby'}]);
});

test('a new dish enters the lobby first and adding an assigned dish never duplicates or moves it', () => {
  const plan = [{id: 'rice', slot: 'lunch'}, {id: 'soup', slot: 'dinner'}];
  assert.deepEqual(addToPlan(plan, 'egg', validIds), [
    {id: 'egg', slot: 'lobby'}, ...plan
  ]);
  assert.deepEqual(addToPlan(plan, 'rice', validIds), plan);
  assert.deepEqual(addToPlan(plan, 'old-rice', validIds, {'old-rice': 'rice'}), plan);
  assert.deepEqual(addToPlan(plan, 'missing', validIds), plan);
  assert.deepEqual(addToPlan(plan, null, validIds), plan);
});

test('dishes move between meals or back to the lobby without changing order or adding unknown dishes', () => {
  const original = [{id: 'egg', slot: 'lobby'}, {id: 'rice', slot: 'lunch'}];
  let plan = moveInPlan(original, 'egg', 'breakfast', validIds);
  assert.deepEqual(plan, [{id: 'egg', slot: 'breakfast'}, original[1]]);
  plan = moveInPlan(plan, 'egg', 'dinner', validIds);
  assert.equal(plan[0].slot, 'dinner');
  plan = moveInPlan(plan, 'egg', 'lobby', validIds);
  assert.deepEqual(plan, original);
  for (const slot of ['snack', 'constructor', '', undefined, null]) {
    assert.deepEqual(moveInPlan(original, 'rice', slot, validIds), original);
  }
  assert.deepEqual(moveInPlan(original, 'soup', 'dinner', validIds), original);
  assert.deepEqual(moveInPlan(original, 'missing', 'dinner', validIds), original);
  assert.deepEqual(moveInPlan(original, 'old-rice', 'dinner', validIds, {'old-rice': 'rice'}), [
    original[0], {id: 'rice', slot: 'dinner'}
  ]);
});

test('removing dishes accepts migrated IDs and leaves unrelated entries intact', () => {
  const plan = [{id: 'egg', slot: 'breakfast'}, {id: 'rice', slot: 'lunch'}, {id: 'soup', slot: 'lobby'}];
  assert.deepEqual(removeFromPlan(plan, 'rice', validIds), [plan[0], plan[2]]);
  assert.deepEqual(removeFromPlan(plan, 'old-rice', validIds, {'old-rice': 'rice'}), [plan[0], plan[2]]);
  assert.deepEqual(removeFromPlan(plan, 'unknown', validIds), plan);
  assert.deepEqual(removeFromPlan([{id: 'egg'}], 'egg', validIds), []);
});

test('the 1000 dish limit applies after validation and deduplication', () => {
  const ids = Array.from({length: 1002}, (_, index) => `dish-${index}`);
  const plan = ids.map(id => ({id, slot: 'lobby'}));
  const cleaned = cleanPlan([{id: 'invalid'}, plan[0], plan[0], ...plan], ids);
  assert.equal(cleaned.length, 1000);
  assert.equal(cleaned[0].id, 'dish-0');
  assert.equal(cleaned.at(-1).id, 'dish-999');
  const added = addToPlan(cleaned, 'dish-1001', ids);
  assert.equal(added.length, 1000);
  assert.equal(added[0].id, 'dish-1001');
  assert.equal(added.at(-1).id, 'dish-998');
  assert.equal(new Set(added.map(item => item.id)).size, 1000);
});

test('cleaning, adding, moving and removing never mutate caller-owned arrays or entries', () => {
  const plan = Object.freeze([
    Object.freeze({id: 'egg', slot: 'breakfast'}),
    Object.freeze({id: 'rice', slot: 'lunch'})
  ]);
  const ids = Object.freeze(['egg', 'rice', 'soup']);
  const aliases = Object.freeze({'old-rice': 'rice'});
  const results = [
    cleanPlan(plan, ids, aliases), addToPlan(plan, 'soup', ids, aliases),
    addToPlan(plan, 'rice', ids, aliases), moveInPlan(plan, 'egg', 'dinner', ids, aliases),
    removeFromPlan(plan, 'old-rice', ids, aliases)
  ];
  for (const result of results) {
    assert.notEqual(result, plan);
    for (const item of result) assert.ok(!plan.includes(item));
  }
  results[0][0].slot = 'dinner';
  assert.deepEqual(plan, [{id: 'egg', slot: 'breakfast'}, {id: 'rice', slot: 'lunch'}]);
  assert.deepEqual(ids, ['egg', 'rice', 'soup']);
  assert.deepEqual(aliases, {'old-rice': 'rice'});
});
