import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, RedXaiDatabase, serialize } from '../src/index.js';

const referencedSource = `{RedXaiStore[ID=1]=[
{Root[ID=2]}=;[
  {Child[ID=3]}="value",
  {Link[ID=4]}=@3,
  {Nested[ID=5]}=;[{Deep[ID=6]}=TRUE]:
]:,
{Count[ID=7]}=1
]};`;

function fresh() {
  return new RedXaiDatabase(parse(referencedSource));
}

test('failed duplicate-ID add restores the exact document and indexes', () => {
  const db = fresh();
  const before = serialize(db.snapshot());

  assert.throws(() => db.add(0, 'Duplicate', 99, 3), /Duplicate ID 3/);

  assert.equal(serialize(db.snapshot()), before);
  assert.equal(db.getById(3).name, 'Child');
  assert.equal(db.getByName('duplicate').length, 0);
  assert.equal(db.nextId(), 8);
});

test('deleting a referenced value fails atomically and restores it', () => {
  const db = fresh();
  const before = serialize(db.snapshot());

  assert.throws(() => db.deleteById(3), /Reference target ID 3 does not exist/);

  assert.equal(serialize(db.snapshot()), before);
  assert.equal(db.requireById(3).value.value, 'value');
  assert.equal(db.requireById(4).value.target.value, 3);
});

test('failed copy with a duplicate explicit root ID leaves no partial subtree', () => {
  const db = fresh();
  const before = serialize(db.snapshot());

  assert.throws(() => db.copyById(2, { newId: 7, newName: 'BadCopy' }), /Duplicate ID 7/);

  assert.equal(serialize(db.snapshot()), before);
  assert.equal(db.getByName('badcopy').length, 0);
  assert.equal(db.nextId(), 8);
});

test('copy remaps references that point inside the copied subtree', () => {
  const db = fresh();
  const result = db.copyById(2, { newName: 'RootCopy' });

  const copiedChildId = result.idMap.get(3);
  const copiedLinkId = result.idMap.get(4);
  assert.ok(Number.isInteger(copiedChildId));
  assert.ok(Number.isInteger(copiedLinkId));
  assert.notEqual(copiedChildId, 3);
  assert.equal(db.requireById(copiedLinkId).value.target.value, copiedChildId);
  assert.equal(db.requireById(4).value.target.value, 3);
});

test('moving a value into its descendant is rejected without altering order', () => {
  const db = fresh();
  const before = serialize(db.snapshot());

  assert.throws(() => db.moveById(2, 5), /descendants/);

  assert.equal(serialize(db.snapshot()), before);
  assert.equal(db.document.databases[0].entries[0].id, 2);
});

test('async transaction rejection never reaches the live database', async () => {
  const db = fresh();
  const before = serialize(db.snapshot());

  await assert.rejects(
    db.transaction(async (draft) => {
      draft.setById(7, 999);
      await Promise.resolve();
      throw new Error('abort async transaction');
    }),
    /abort async transaction/,
  );

  assert.equal(serialize(db.snapshot()), before);
  assert.equal(db.requireById(7).value.value, 1);
});

test('failed mutation after a successful mutation restores the latest valid state', () => {
  const db = fresh();
  db.setById(7, 42);
  const committed = serialize(db.snapshot());

  assert.throws(() => db.addToArray(2, 'DuplicateChild', false, 3), /Duplicate ID 3/);

  assert.equal(serialize(db.snapshot()), committed);
  assert.equal(db.requireById(7).value.value, 42);
  assert.equal(db.getByName('duplicatechild').length, 0);
});
