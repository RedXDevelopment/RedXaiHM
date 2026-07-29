import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RedXaiFileStore, createDocument, assignment } from '../src/index.js';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'redxaihm-hardening-'));
  return { directory, file: join(directory, 'Counter.RedXai') };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('concurrent transactions serialize the entire read-modify-write cycle', async () => {
  const { file } = await fixture();
  const firstStore = new RedXaiFileStore({ lockTimeoutMs: 5_000 });
  const secondStore = new RedXaiFileStore({ lockTimeoutMs: 5_000 });
  await firstStore.save(file, createDocument({ entries: [assignment('Count', 0, 2)] }));

  const first = firstStore.transaction(file, async (db) => {
    const current = db.requireById(2).value.value;
    await sleep(150);
    db.setById(2, current + 1);
  });
  await sleep(20);
  const second = secondStore.transaction(file, async (db) => {
    const current = db.requireById(2).value.value;
    await sleep(20);
    db.setById(2, current + 1);
  });

  await Promise.all([first, second]);
  const loaded = await firstStore.load(file);
  assert.equal(loaded.database.requireById(2).value.value, 2);
});

test('lock heartbeat prevents a long live transaction from being stolen as stale', async () => {
  const { file } = await fixture();
  const options = { staleLockMs: 150, lockTimeoutMs: 3_000 };
  const firstStore = new RedXaiFileStore(options);
  const secondStore = new RedXaiFileStore(options);
  await firstStore.save(file, createDocument({ entries: [assignment('Count', 0, 2)] }));

  const first = firstStore.transaction(file, async (db) => {
    await sleep(450);
    db.setById(2, 1);
  });
  await sleep(250);
  const second = secondStore.transaction(file, (db) => {
    db.setById(2, db.requireById(2).value.value + 1);
  });

  await Promise.all([first, second]);
  const loaded = await firstStore.load(file);
  assert.equal(loaded.database.requireById(2).value.value, 2);
});

test('an abandoned stale lock is removed and does not block a valid save', async () => {
  const { file } = await fixture();
  const store = new RedXaiFileStore({ staleLockMs: 50, lockTimeoutMs: 1_000 });
  const lockPath = `${file}.lock`;
  await writeFile(lockPath, '{"pid":999999,"createdAt":"old"}', { mode: 0o600 });
  const old = new Date(Date.now() - 10_000);
  await utimes(lockPath, old, old);

  await store.save(file, createDocument({ entries: [assignment('Ready', true, 2)] }));
  const loaded = await store.load(file);
  assert.equal(loaded.database.requireById(2).value.value, true);
});

test('primary and backup corruption are both rejected', async () => {
  const { file } = await fixture();
  const store = new RedXaiFileStore();
  const document = createDocument({ entries: [assignment('Count', 1, 2)] });
  await store.save(file, document);
  document.databases[0].entries[0].value.value = 2;
  await store.save(file, document);
  await writeFile(file, 'corrupt primary', 'utf8');
  await writeFile(`${file}.bak`, 'corrupt backup', 'utf8');

  await assert.rejects(() => store.load(file), /Unable to load/);
});

test('database, backup, and lock files are never created world-readable', async () => {
  if (process.platform === 'win32') return;
  const { file } = await fixture();
  const store = new RedXaiFileStore();
  const document = createDocument({ entries: [assignment('SecretMetadata', 'not-a-secret', 2)] });
  await store.save(file, document);
  document.databases[0].entries[0].value.value = 'changed';
  await store.save(file, document);

  const databaseMode = (await stat(file)).mode & 0o777;
  const backupMode = (await stat(`${file}.bak`)).mode & 0o777;
  assert.equal(databaseMode, 0o600);
  assert.equal(backupMode, 0o600);
  assert.match(await readFile(`${file}.bak`, 'utf8'), /not-a-secret/);
});
