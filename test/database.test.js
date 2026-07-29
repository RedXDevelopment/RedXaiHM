import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, RedXaiDatabase, toPlainValue } from '../src/index.js';

const source = `{RedXaiStore[ID=1]=[
{Root[ID=2]}=;[
  {Name[ID=3]}="Alpha",
  {NestedArray[ID=4]}=;[{Enabled[ID=5]}=TRUE]:
]:,
{Count[ID=6]}=1
]};`;

test('database indexes nested IDs at database scope', () => {
  const db = new RedXaiDatabase(parse(source));
  assert.equal(db.getById(5).name, 'Enabled');
  assert.equal(db.getByName('name')[0].id, 3);
});

test('set and rename update indexed values', () => {
  const db = new RedXaiDatabase(parse(source));
  db.setById(6, 42);
  db.renameById(3, 'DisplayName');
  assert.equal(db.getById(6).value.value, 42);
  assert.equal(db.getByName('displayname')[0].id, 3);
});

test('move relocates an assignment into another array', () => {
  const db = new RedXaiDatabase(parse(source));
  db.moveById(6, 4);
  assert.equal(db.requireById(4).value.items.at(-1).id, 6);
});

test('copy assigns fresh IDs to copied subtree', () => {
  const db = new RedXaiDatabase(parse(source));
  const result = db.copyById(4, { newName: 'NestedCopy' });
  assert.notEqual(result.node.id, 4);
  assert.notEqual(result.node.value.items[0].id, 5);
  assert.equal(db.getByName('nestedcopy').length, 1);
});

test('delete removes indexed data', () => {
  const db = new RedXaiDatabase(parse(source));
  assert.equal(db.deleteById(6), true);
  assert.equal(db.getById(6), null);
  assert.equal(db.deleteById(6), false);
});

test('failed transaction rolls back', () => {
  const db = new RedXaiDatabase(parse(source));
  assert.throws(() => db.transaction((draft) => {
    draft.setById(6, 99);
    draft.add(0, 'Duplicate', 1, 3);
  }));
  assert.equal(db.getById(6).value.value, 1);
});

test('plain conversion turns assignment arrays into objects', () => {
  const db = new RedXaiDatabase(parse(source));
  assert.deepEqual(toPlainValue(db.getById(4).value), { Enabled: true });
});
