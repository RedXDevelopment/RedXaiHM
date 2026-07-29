export function valueFrom(input) {
  if (input && input.kind === 'value') return structuredClone(input);
  if (input === null || input === undefined) return nellValue();
  if (typeof input === 'string') return { kind: 'value', valueType: 'string', value: input };
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new TypeError('RedXai numbers must be finite');
    return { kind: 'value', valueType: 'number', value: input };
  }
  if (typeof input === 'boolean') return { kind: 'value', valueType: 'boolean', value: input };
  if (Array.isArray(input)) {
    return { kind: 'value', valueType: 'array', items: input.map((item) => valueFrom(item)) };
  }
  if (typeof input === 'object') {
    return {
      kind: 'value',
      valueType: 'array',
      items: Object.entries(input).map(([name, value]) => ({
        kind: 'assignment',
        name,
        id: null,
        value: valueFrom(value),
      })),
    };
  }
  throw new TypeError(`Unsupported RedXai value: ${typeof input}`);
}

export function nellValue() {
  return { kind: 'value', valueType: 'nell', value: null };
}

export function booleanValue(value) {
  return { kind: 'value', valueType: 'boolean', value: Boolean(value) };
}

export function stringValue(value) {
  return { kind: 'value', valueType: 'string', value: String(value) };
}

export function numberValue(value) {
  if (!Number.isFinite(value)) throw new TypeError('RedXai numbers must be finite');
  return { kind: 'value', valueType: 'number', value };
}

export function percentValue(value) {
  if (!Number.isFinite(value)) throw new TypeError('RedXai percentages must be finite');
  return { kind: 'value', valueType: 'percent', value };
}

export function referenceById(id) {
  return { kind: 'value', valueType: 'reference', target: { type: 'id', value: id } };
}

export function referenceByName(name) {
  return { kind: 'value', valueType: 'reference', target: { type: 'name', value: name } };
}

export function assignment(name, value, id = null) {
  return { kind: 'assignment', name, id, value: valueFrom(value) };
}

export function createDatabase(options = {}) {
  return {
    kind: 'database',
    name: 'RedXaiStore',
    id: 1,
    version: options.version ?? '0.1',
    headerExtras: {},
    entries: options.entries ? structuredClone(options.entries) : [],
    metadata: {
      shared: booleanValue(options.shared ?? false),
      shareId: options.shareId == null ? nellValue() : valueFrom(options.shareId),
      allowedProjectFiles: options.allowedProjectFiles == null
        ? nellValue()
        : { kind: 'value', valueType: 'collection', items: options.allowedProjectFiles.map(stringValue) },
      globalAccess: booleanValue(options.globalAccess ?? false),
      globalId: options.globalId == null ? nellValue() : valueFrom(options.globalId),
      extras: {},
      syntax: 'canonical',
    },
  };
}

export function createDocument(options = {}) {
  return {
    kind: 'document',
    format: 'RedXaiHM',
    databases: options.databases ? structuredClone(options.databases) : [createDatabase(options)],
  };
}

export function toPlainValue(value, options = {}) {
  switch (value.valueType) {
    case 'nell': return null;
    case 'string':
    case 'number':
    case 'percent':
    case 'boolean':
    case 'symbol': return value.value;
    case 'reference': return options.referencesAsObjects === false ? `@${value.target.value}` : { $ref: value.target };
    case 'collection': return value.items.filter((item) => item.kind === 'value').map((item) => toPlainValue(item, options));
    case 'array': {
      const content = value.items.filter((item) => item.kind !== 'comment');
      if (content.every((item) => item.kind === 'assignment')) {
        return Object.fromEntries(content.map((item) => [item.name, toPlainValue(item.value, options)]));
      }
      return content.map((item) => item.kind === 'assignment'
        ? { [item.name]: toPlainValue(item.value, options) }
        : toPlainValue(item, options));
    }
    default: throw new TypeError(`Unknown RedXai value type ${value.valueType}`);
  }
}
