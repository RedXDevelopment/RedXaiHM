import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RedXaiFileStore, createDocument, assignment } from '../src/index.js';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'redxaihm-'));
  return { directory, file: join(directory, 'Accounts.RedXai') };
}

test('file store saves and loads exact .RedXai files', async () => {
  const { file } = await fixture();
  const document = createDocument({ entries: [assignment('Email', 'a@example.com', 2)] });
  const store = new RedXaiFileStore();
  const saved = await store.save(file, document);
  assert.ok(saved.bytes > 0);
  const loaded = await store.load(file);
  assert.equal(loaded.database.getById(2).value.value, 'a@example.com');
});

test('second save creates a backup', async () => {
  const { file } = await fixture();
  const store = new RedXaiFileStore();
  const document = createDocument({ entries: [assignment('Count', 1, 2)] });
  await store.save(file, document);
  document.databases[0].entries[0].value.value = 2;
  await store.save(file, document);
  await access(`${file}.bak`);
  assert.match(await readFile(`${file}.bak`, 'utf8'), / = 1/);
});

test('invalid primary file can recover from validated backup', async () => {
  const { file } = await fixture();
  const store = new RedXaiFileStore();
  const document = createDocument({ entries: [assignment('Count', 1, 2)] });
  await store.save(file, document);
  document.databases[0].entries[0].value.value = 2;
  await store.save(file, document);
  await writeFile(file, 'corrupt', 'utf8');
  const loaded = await store.load(file);
  assert.equal(loaded.database.getById(2).value.value, 1);
  assert.equal(loaded.recoveredFrom, `${file}.bak`);
});

test('file store rejects the wrong extension', async () => {
  const { directory } = await fixture();
  const store = new RedXaiFileStore();
  await assert.rejects(() => store.save(join(directory, 'bad.redxai'), createDocument()), /exact \.RedXai/);
});

test('file transaction persists SDK changes', async () => {
  const { file } = await fixture();
  const store = new RedXaiFileStore();
  await store.save(file, createDocument({ entries: [assignment('Count', 1, 2)] }));
  await store.transaction(file, (db) => db.setById(2, 77));
  const loaded = await store.load(file);
  assert.equal(loaded.database.getById(2).value.value, 77);
});
