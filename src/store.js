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
    const warnings = assertValid(document);
    const source = serialize(document, { indent: this.options.indent });
    await mkdir(dirname(filePath), { recursive: true });
    const release = await this.acquireLock(filePath);
    const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    try {
      if (this.options.backup && await exists(filePath)) await copyFile(filePath, `${filePath}.bak`);
      const handle = await open(temporaryPath, 'wx', 0o600);
      try {
        await handle.writeFile(source, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporaryPath, filePath);
      await syncDirectory(dirname(filePath));
      return { filePath, bytes: Buffer.byteLength(source), warnings };
    } catch (error) {
      await unlink(temporaryPath).catch(() => {});
      throw new RedXaiStorageError(`Failed to save ${filePath}`, { cause: error });
    } finally {
      await release();
    }
  }

  async transaction(filePath, callback) {
    const loaded = await this.load(filePath);
    const result = await loaded.database.transaction(callback);
    await this.save(filePath, loaded.database.document);
    return result;
  }

  async acquireLock(filePath) {
    const lockPath = `${filePath}.lock`;
    const started = Date.now();
    while (true) {
      try {
        const handle = await open(lockPath, 'wx', 0o600);
        await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
        return async () => {
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

async function syncDirectory(directory) {
  try {
    const handle = await open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  } catch {
    // Some platforms do not support fsync on directories. The file itself is already synced.
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export { FILE_EXTENSION };
