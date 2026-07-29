import { randomUUID } from 'node:crypto';
import { open, readFile, rename, copyFile, mkdir, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parse } from './parser.js';
import { serialize } from './serializer.js';
import { assertValid } from './validator.js';
import { RedXaiDatabase } from './database.js';
import { RedXaiStorageError } from './errors.js';

const FILE_EXTENSION = '.RedXai';

export class RedXaiFileStore {
  constructor(options = {}) {
    this.options = {
      lockTimeoutMs: options.lockTimeoutMs ?? 5_000,
      staleLockMs: options.staleLockMs ?? 30_000,
      backup: options.backup !== false,
      recover: options.recover !== false,
      indent: options.indent ?? 2,
    };
  }

  async load(filePath) {
    assertExtension(filePath);
    try {
      return await this.loadExact(filePath);
    } catch (primaryError) {
      if (!this.options.recover) throw primaryError;
      const backupPath = `${filePath}.bak`;
      try {
        const recovered = await this.loadExact(backupPath, false);
        recovered.recoveredFrom = backupPath;
        return recovered;
      } catch {
        throw new RedXaiStorageError(`Unable to load ${filePath} or its backup`, { cause: primaryError });
      }
    }
  }

  async loadExact(filePath, checkExtension = true) {
    if (checkExtension) assertExtension(filePath);
    const source = await readFile(filePath, 'utf8');
    const document = parse(source);
    const warnings = assertValid(document);
    return { filePath, source, document, database: new RedXaiDatabase(document), warnings };
  }

  async save(filePath, document) {
    assertExtension(filePath);
    const prepared = this.prepareDocument(document);
    await mkdir(dirname(filePath), { recursive: true });
    const release = await this.acquireLock(filePath);
    try {
      return await this.writeLocked(filePath, prepared);
    } finally {
      await release();
    }
  }

  async transaction(filePath, callback) {
    assertExtension(filePath);
    await mkdir(dirname(filePath), { recursive: true });
    const release = await this.acquireLock(filePath);
    try {
      // Loading while holding the same lock prevents the classic read-modify-write
      // race where two writers both commit from an identical stale snapshot.
      const loaded = await this.load(filePath);
      const result = await loaded.database.transaction(callback);
      const prepared = this.prepareDocument(loaded.database.document);
      await this.writeLocked(filePath, prepared);
      return result;
    } finally {
      await release();
    }
  }

  prepareDocument(document) {
    const warnings = assertValid(document);
    const source = serialize(document, { indent: this.options.indent });
    return { source, warnings };
  }

  async writeLocked(filePath, prepared) {
    const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
    const backupPath = `${filePath}.bak`;
    const backupTemporaryPath = `${backupPath}.tmp-${process.pid}-${randomUUID()}`;
    try {
      if (this.options.backup && await exists(filePath)) {
        await copyFile(filePath, backupTemporaryPath);
        await syncFile(backupTemporaryPath);
        await rename(backupTemporaryPath, backupPath);
      }

      const handle = await open(temporaryPath, 'wx', 0o600);
      try {
        await handle.writeFile(prepared.source, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporaryPath, filePath);
      await syncDirectory(dirname(filePath));
      return {
        filePath,
        bytes: Buffer.byteLength(prepared.source),
        warnings: prepared.warnings,
      };
    } catch (error) {
      await unlink(temporaryPath).catch(() => {});
      await unlink(backupTemporaryPath).catch(() => {});
      throw new RedXaiStorageError(`Failed to save ${filePath}`, { cause: error });
    }
  }

  async acquireLock(filePath) {
    const lockPath = `${filePath}.lock`;
    const started = Date.now();
    while (true) {
      try {
        const handle = await open(lockPath, 'wx', 0o600);
        await handle.writeFile(JSON.stringify({
          pid: process.pid,
          createdAt: new Date().toISOString(),
          token: randomUUID(),
        }));
        await handle.sync();

        // Refresh the lock mtime while a valid writer is alive. A long transaction
        // must not be mistaken for a crashed process merely because staleLockMs elapsed.
        const heartbeatMs = Math.max(100, Math.floor(this.options.staleLockMs / 3));
        const heartbeat = setInterval(() => {
          const now = new Date();
          handle.utimes(now, now).catch(() => {});
        }, heartbeatMs);
        heartbeat.unref?.();

        let released = false;
        return async () => {
          if (released) return;
          released = true;
          clearInterval(heartbeat);
          await handle.close().catch(() => {});
          await unlink(lockPath).catch(() => {});
        };
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        if (await isStale(lockPath, this.options.staleLockMs)) {
          await unlink(lockPath).catch(() => {});
          continue;
        }
        if (Date.now() - started >= this.options.lockTimeoutMs) {
          throw new RedXaiStorageError(`Timed out waiting for database lock ${lockPath}`);
        }
        await delay(50);
      }
    }
  }
}

export function assertExtension(filePath) {
  if (!String(filePath).endsWith(FILE_EXTENSION)) {
    throw new RedXaiStorageError(`RedXaiHM database files must use the exact ${FILE_EXTENSION} extension`);
  }
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function isStale(lockPath, staleMs) {
  try {
    const info = await stat(lockPath);
    return Date.now() - info.mtimeMs > staleMs;
  } catch (error) {
    return error?.code === 'ENOENT';
  }
}

async function syncFile(filePath) {
  const handle = await open(filePath, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directory) {
  try {
    const handle = await open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  } catch {
    // Some platforms do not support fsync on directories. The files themselves are synced.
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export { FILE_EXTENSION };
