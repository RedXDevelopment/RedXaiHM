import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchEditor } from '../src/editor-server.js';
import { RedXaiFileStore, createDocument, assignment } from '../src/index.js';

test('local editor serves, validates, and saves through the storage engine', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'redxai-editor-'));
  const file = join(directory, 'Editor.RedXai');
  const store = new RedXaiFileStore();
  await store.save(file, createDocument({ entries: [assignment('Count', 1, 2)] }));

  const launched = await launchEditor(file, { open: false });
  context.after(() => new Promise((resolve) => launched.server.close(resolve)));
  const url = new URL(launched.url);
  const token = url.searchParams.get('token');

  const loadedResponse = await fetch(`${url.origin}/api/document?token=${token}`);
  assert.equal(loadedResponse.status, 200);
  const loaded = await loadedResponse.json();
  assert.match(loaded.source, /Count/);

  const changed = loaded.source.replace(' = 1', ' = 9');
  const saveResponse = await fetch(`${url.origin}/api/save?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: changed }),
  });
  assert.equal(saveResponse.status, 200);
  assert.equal((await store.load(file)).database.getById(2).value.value, 9);

  const forbidden = await fetch(`${url.origin}/api/document?token=wrong`);
  assert.equal(forbidden.status, 403);
});
