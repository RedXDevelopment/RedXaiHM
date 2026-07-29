#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse, parseValue } from './parser.js';
import { serialize } from './serializer.js';
import { validate } from './validator.js';
import { RedXaiFileStore } from './store.js';
import { createDocument, toPlainValue } from './model.js';
import { launchEditor } from './editor-server.js';

const [, , command, ...args] = process.argv;
const store = new RedXaiFileStore();

try {
  switch (command) {
    case 'init': await init(args); break;
    case 'validate': await validateCommand(args); break;
    case 'format': await format(args); break;
    case 'get': await get(args); break;
    case 'set': await set(args); break;
    case 'delete': await remove(args); break;
    case 'edit': await edit(args); break;
    case 'help':
    case undefined: printHelp(); break;
    default: throw new Error(`Unknown command ${command}`);
  }
} catch (error) {
  console.error(`RedXaiHM: ${error.message}`);
  if (error.issues) {
    for (const current of error.issues) console.error(`  ${current.code} ${current.path}: ${current.message}`);
  }
  process.exitCode = 1;
}

async function init([file]) {
  requireArg(file, 'init requires a .RedXai file path');
  const path = resolve(file);
  await store.save(path, createDocument());
  console.log(`Created ${path}`);
}

async function validateCommand([file]) {
  requireArg(file, 'validate requires a .RedXai file path');
  const source = await readFile(resolve(file), 'utf8');
  const document = parse(source);
  const issues = validate(document);
  for (const current of issues) console.log(`${current.severity.toUpperCase()} ${current.code} ${current.path}: ${current.message}`);
  if (issues.some((current) => current.severity === 'error')) process.exitCode = 1;
  else console.log(`Valid RedXaiHM database${issues.length ? ` with ${issues.length} warning(s)` : ''}.`);
}

async function format([file, flag]) {
  requireArg(file, 'format requires a .RedXai file path');
  const path = resolve(file);
  const document = parse(await readFile(path, 'utf8'));
  const output = serialize(document);
  if (flag === '--write') {
    await writeFile(path, output, 'utf8');
    console.log(`Formatted ${path}`);
  } else {
    process.stdout.write(output);
  }
}

async function get([file, idText]) {
  requireArg(file && idText, 'get requires a file and numeric ID');
  const loaded = await store.load(resolve(file));
  const node = loaded.database.requireById(parseId(idText));
  console.log(JSON.stringify({ id: node.id, name: node.name, value: toPlainValue(node.value) }, null, 2));
}

async function set([file, idText, ...literalParts]) {
  requireArg(file && idText && literalParts.length, 'set requires a file, numeric ID, and RedXai value');
  const path = resolve(file);
  const value = parseValue(literalParts.join(' '));
  await store.transaction(path, (database) => database.setById(parseId(idText), value));
  console.log(`Updated ID ${idText} in ${path}`);
}

async function remove([file, idText]) {
  requireArg(file && idText, 'delete requires a file and numeric ID');
  const path = resolve(file);
  const deleted = await store.transaction(path, (database) => database.deleteById(parseId(idText)));
  if (!deleted) throw new Error(`ID ${idText} was not found`);
  console.log(`Deleted ID ${idText} from ${path}`);
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 1) throw new Error('ID must be an integer greater than 1');
  return id;
}

function requireArg(value, message) {
  if (!value) throw new Error(message);
}

async function edit([file]) {
  requireArg(file, 'edit requires a .RedXai file path');
  const launched = await launchEditor(resolve(file));
  console.log(`RedXaiHM Editor: ${launched.url}`);
}

function printHelp() {
  console.log(`RedXaiHM CLI\n\nCommands:\n  redxai init <file.RedXai>\n  redxai validate <file.RedXai>\n  redxai format <file.RedXai> [--write]\n  redxai get <file.RedXai> <id>\n  redxai set <file.RedXai> <id> <RedXai-value>\n  redxai delete <file.RedXai> <id>\n  redxai edit <file.RedXai>`);
}
