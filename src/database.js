import { assertValid } from './validator.js';
import { valueFrom, assignment as createAssignment } from './model.js';

export class RedXaiDatabase {
  constructor(document, options = {}) {
    this.document = structuredClone(document);
    this.options = { validate: options.validate !== false };
    if (this.options.validate) assertValid(this.document);
    this.rebuildIndex();
  }

  rebuildIndex() {
    this.idIndex = new Map();
    this.nameIndex = new Map();
    this.containers = [];
    this.document.databases.forEach((database, databaseIndex) => {
      this.indexContainer(database.entries, { kind: 'database', databaseIndex, items: database.entries });
    });
  }

  indexContainer(items, container) {
    this.containers.push(container);
    items.forEach((item, index) => {
      if (item.kind !== 'assignment') return;
      const record = { node: item, container: items, index, databaseIndex: container.databaseIndex };
      if (item.id != null) this.idIndex.set(item.id, record);
      const key = item.name.toLowerCase();
      const list = this.nameIndex.get(key) ?? [];
      list.push(record);
      this.nameIndex.set(key, list);
      if (item.value.valueType === 'array') {
        this.indexContainer(item.value.items, {
          kind: 'array',
          databaseIndex: container.databaseIndex,
          owner: item,
          items: item.value.items,
        });
      }
    });
  }

  getById(id) {
    return this.idIndex.get(id)?.node ?? null;
  }

  requireById(id) {
    const node = this.getById(id);
    if (!node) throw new RangeError(`RedXai ID ${id} was not found`);
    return node;
  }

  getByName(name) {
    return (this.nameIndex.get(String(name).toLowerCase()) ?? []).map((record) => record.node);
  }

  nextId() {
    let max = 1;
    for (const id of this.idIndex.keys()) max = Math.max(max, id);
    return max + 1;
  }

  setById(id, value) {
    const node = this.requireById(id);
    node.value = valueFrom(value);
    this.commitMutation();
    return node;
  }

  renameById(id, name) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name)) throw new TypeError('Invalid RedXai variable name');
    const node = this.requireById(id);
    node.name = name;
    this.commitMutation();
    return node;
  }

  add(databaseIndex, name, value, id = null) {
    const database = this.document.databases[databaseIndex];
    if (!database) throw new RangeError(`Database index ${databaseIndex} does not exist`);
    const actualId = id ?? this.nextId();
    const node = createAssignment(name, value, actualId);
    database.entries.push(node);
    this.commitMutation();
    return node;
  }

  addToArray(arrayId, name, value, id = null) {
    const owner = this.requireById(arrayId);
    if (owner.value.valueType !== 'array') throw new TypeError(`ID ${arrayId} is not an array`);
    const actualId = id ?? this.nextId();
    const node = createAssignment(name, value, actualId);
    owner.value.items.push(node);
    this.commitMutation();
    return node;
  }

  deleteById(id) {
    const record = this.idIndex.get(id);
    if (!record) return false;
    record.container.splice(record.index, 1);
    this.commitMutation();
    return true;
  }

  moveById(id, targetArrayId, index = null) {
    const record = this.idIndex.get(id);
    if (!record) throw new RangeError(`RedXai ID ${id} was not found`);
    if (id === targetArrayId) throw new TypeError('A value cannot be moved inside itself');
    const target = this.requireById(targetArrayId);
    if (target.value.valueType !== 'array') throw new TypeError(`Target ID ${targetArrayId} is not an array`);
    if (containsId(record.node, targetArrayId)) throw new TypeError('A value cannot be moved into one of its descendants');

    const [node] = record.container.splice(record.index, 1);
    const insertion = index == null ? target.value.items.length : Math.max(0, Math.min(index, target.value.items.length));
    target.value.items.splice(insertion, 0, node);
    this.commitMutation();
    return node;
  }

  copyById(id, options = {}) {
    const record = this.idIndex.get(id);
    if (!record) throw new RangeError(`RedXai ID ${id} was not found`);
    const clone = structuredClone(record.node);
    const idMap = new Map();
    let next = this.nextId();
    remapIds(clone, (oldId, isRoot) => {
      const replacement = isRoot && options.newId != null ? options.newId : next++;
      if (oldId != null) idMap.set(oldId, replacement);
      return replacement;
    }, true);
    if (options.newName) clone.name = options.newName;

    const target = options.targetArrayId == null ? record.container : this.requireArray(options.targetArrayId).value.items;
    const insertion = options.index == null ? target.length : Math.max(0, Math.min(options.index, target.length));
    target.splice(insertion, 0, clone);
    this.commitMutation();
    return { node: clone, idMap };
  }

  requireArray(id) {
    const node = this.requireById(id);
    if (node.value.valueType !== 'array') throw new TypeError(`ID ${id} is not an array`);
    return node;
  }

  transaction(callback) {
    const draft = new RedXaiDatabase(this.document, { validate: false });
    const result = callback(draft);
    if (result && typeof result.then === 'function') {
      return result.then((resolved) => {
        assertValid(draft.document);
        draft.rebuildIndex();
        this.document = draft.document;
        this.rebuildIndex();
        return resolved;
      });
    }
    assertValid(draft.document);
    draft.rebuildIndex();
    this.document = draft.document;
    this.rebuildIndex();
    return result;
  }

  snapshot() {
    return structuredClone(this.document);
  }

  commitMutation() {
    if (this.options.validate) assertValid(this.document);
    this.rebuildIndex();
  }
}

function containsId(node, id) {
  if (node.id === id) return true;
  if (node.value?.valueType !== 'array') return false;
  return node.value.items.some((item) => item.kind === 'assignment' && containsId(item, id));
}

function remapIds(node, allocator, isRoot = false) {
  if (node.kind === 'assignment') {
    node.id = allocator(node.id, isRoot);
    if (node.value.valueType === 'array') {
      node.value.items.forEach((item) => {
        if (item.kind === 'assignment') remapIds(item, allocator, false);
      });
    }
  }
}
