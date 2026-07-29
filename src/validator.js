import { RedXaiValidationError } from './errors.js';

const issue = (code, message, path, node, severity = 'error') => ({
  code,
  message,
  path,
  severity,
  location: node?.location?.start ?? null,
});

export function validate(document) {
  const issues = [];
  if (!document || document.kind !== 'document' || !Array.isArray(document.databases)) {
    return [issue('RXH000', 'Root value must be a RedXai document', '$', document)];
  }
  if (document.databases.length === 0) {
    issues.push(issue('RXH001', 'Document must contain at least one database', '$', document));
    return issues;
  }

  const projectIds = new Map();
  const referenceIds = collectDocumentIds(document);
  document.databases.forEach((database, databaseIndex) => {
    const path = `$.databases[${databaseIndex}]`;
    validateDatabase(database, path, issues, projectIds, referenceIds);
  });
  return issues;
}

function validateDatabase(database, path, issues, projectIds, referenceIds) {
  if (database.name !== 'RedXaiStore') {
    issues.push(issue('RXH100', 'Database header must be named RedXaiStore', `${path}.name`, database));
  }
  if (database.id !== 1 || !Number.isInteger(database.id)) {
    issues.push(issue('RXH101', 'Every database header ID must be exactly 1', `${path}.id`, database));
  }
  if (typeof database.version !== 'string' || database.version.trim() === '') {
    issues.push(issue('RXH102', 'Database Version must be a non-empty string', `${path}.version`, database));
  }

  const localIds = new Map();
  const localNames = new Map();
  let encounteredRegularEntry = false;

  for (let i = 0; i < database.entries.length; i += 1) {
    const entry = database.entries[i];
    const entryPath = `${path}.entries[${i}]`;
    if (entry.kind === 'comment') continue;
    const accessPoint = isAccessPoint(entry);
    if (accessPoint && encounteredRegularEntry) {
      issues.push(issue('RXH130', 'Access points must appear before stored values', entryPath, entry));
    }
    if (!accessPoint) encounteredRegularEntry = true;
    validateAssignment(entry, entryPath, issues, localIds, localNames, projectIds);
  }

  validateMetadata(database.metadata, `${path}.metadata`, issues, database);
  validateReferences(database, path, issues, localIds, localNames, referenceIds);
}

function validateAssignment(node, path, issues, localIds, localNames, projectIds) {
  if (!node || node.kind !== 'assignment') {
    issues.push(issue('RXH110', 'Database entries must be variables or comments', path, node));
    return;
  }
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(node.name)) {
    issues.push(issue('RXH111', `Invalid variable name ${JSON.stringify(node.name)}`, `${path}.name`, node));
  }
  if (node.id !== null && node.id !== undefined) {
    if (!Number.isInteger(node.id) || node.id <= 1) {
      issues.push(issue('RXH112', 'Variable IDs must be integers greater than 1; 0 and 1 are reserved', `${path}.id`, node));
    } else {
      registerId(localIds, node.id, path, node, issues, 'database');
      registerId(projectIds, node.id, path, node, issues, 'document/project');
    }
  }

  const normalizedName = node.name.toLowerCase();
  const names = localNames.get(normalizedName) ?? [];
  names.push({ node, path });
  localNames.set(normalizedName, names);
  validateValue(node.value, `${path}.value`, issues, localIds, localNames, projectIds);

  if (isAccessPoint(node)) validateAccessPoint(node, path, issues);
}

function validateValue(value, path, issues, localIds, localNames, projectIds) {
  if (!value || value.kind !== 'value') {
    issues.push(issue('RXH120', 'Expected a RedXai value node', path, value));
    return;
  }
  switch (value.valueType) {
    case 'string':
      if (typeof value.value !== 'string') issues.push(issue('RXH121', 'String value must contain text', path, value));
      break;
    case 'number':
    case 'percent':
      if (typeof value.value !== 'number' || !Number.isFinite(value.value)) {
        issues.push(issue('RXH122', `${value.valueType} must be a finite number`, path, value));
      }
      break;
    case 'boolean':
      if (typeof value.value !== 'boolean') issues.push(issue('RXH123', 'Boolean value must be true or false', path, value));
      break;
    case 'nell':
      break;
    case 'symbol':
      if (typeof value.value !== 'string' || value.value.length === 0) issues.push(issue('RXH124', 'Symbol cannot be empty', path, value));
      break;
    case 'reference':
      if (!value.target || !['id', 'name'].includes(value.target.type)) {
        issues.push(issue('RXH125', 'Reference must target an ID or name', path, value));
      }
      break;
    case 'array':
      value.items.forEach((item, index) => {
        const itemPath = `${path}.items[${index}]`;
        if (item.kind === 'assignment') validateAssignment(item, itemPath, issues, localIds, localNames, projectIds);
        else if (item.kind === 'value') validateValue(item, itemPath, issues, localIds, localNames, projectIds);
        else if (item.kind !== 'comment') issues.push(issue('RXH126', 'Invalid array item', itemPath, item));
      });
      break;
    case 'collection':
      value.items.forEach((item, index) => {
        const itemPath = `${path}.items[${index}]`;
        if (item.kind === 'value') validateValue(item, itemPath, issues, localIds, localNames, projectIds);
        else if (item.kind !== 'comment') issues.push(issue('RXH127', 'Collections can contain values and comments only', itemPath, item));
      });
      break;
    default:
      issues.push(issue('RXH128', `Unknown value type ${JSON.stringify(value.valueType)}`, path, value));
  }
}

function validateMetadata(metadata, path, issues, database) {
  const shared = primitive(metadata.shared);
  const globalAccess = primitive(metadata.globalAccess);
  if (typeof shared !== 'boolean') issues.push(issue('RXH140', 'Shared must be a Boolean', `${path}.shared`, metadata.shared));
  if (typeof globalAccess !== 'boolean') issues.push(issue('RXH141', 'GlobalAccess/GA must be a Boolean', `${path}.globalAccess`, metadata.globalAccess));

  if (shared === true) {
    const shareId = primitive(metadata.shareId);
    if (!Number.isInteger(shareId) || shareId <= 1) issues.push(issue('RXH142', 'A shared database requires a numeric ShareID/ProjectID greater than 1', `${path}.shareId`, metadata.shareId));
    const files = collectionStrings(metadata.allowedProjectFiles);
    if (!files || files.length === 0) {
      issues.push(issue('RXH143', 'A shared database requires at least one OPFNames/AllowedProjectFiles entry', `${path}.allowedProjectFiles`, metadata.allowedProjectFiles));
    }
  }

  if (globalAccess === true) {
    const id = primitive(metadata.globalId);
    if (!Number.isInteger(id) || id <= 1) {
      issues.push(issue('RXH144', 'A global database requires a numeric GlobalID greater than 1', `${path}.globalId`, metadata.globalId));
    }
  }

  if (database.entries.every((entry) => entry.kind === 'comment')) {
    issues.push(issue('RXH145', 'Database contains no stored values', path, database, 'warning'));
  }
}

function validateReferences(database, path, issues, localIds, localNames, referenceIds) {
  walkEntries(database.entries, (value, valuePath) => {
    if (value.kind !== 'value' || value.valueType !== 'reference') return;
    if (value.target.type === 'id') {
      if (!localIds.has(value.target.value) && !referenceIds.has(value.target.value)) {
        issues.push(issue('RXH150', `Reference target ID ${value.target.value} does not exist`, valuePath, value));
      }
    } else if (!localNames.has(String(value.target.value).toLowerCase())) {
      issues.push(issue('RXH151', `Reference target ${value.target.value} does not exist in this database`, valuePath, value));
    }
  }, `${path}.entries`);
}

function validateAccessPoint(node, path, issues) {
  const values = node.value.items.filter((item) => item.kind === 'value');
  if (node.id == null) issues.push(issue('RXH160', 'Access points should have an ID so they can be managed securely', `${path}.id`, node, 'warning'));
  const key = values[0];
  if (!key || key.valueType !== 'string' || key.value.trim().length < 12) {
    issues.push(issue('RXH161', 'Access point API key must be a quoted string of at least 12 characters', `${path}.value.items[0]`, key));
  }
  for (let i = 1; i < values.length; i += 1) {
    const item = values[i];
    if (item.valueType !== 'string' || !/^\.[A-Za-z0-9+#-]+$/.test(item.value)) {
      issues.push(issue('RXH162', 'Allowed languages must be quoted file extensions such as ".js" or ".py"', `${path}.value.items[${i}]`, item));
    }
  }
}

function registerId(map, id, path, node, issues, scope) {
  const existing = map.get(id);
  if (existing) {
    issues.push(issue('RXH113', `Duplicate ID ${id}; IDs must be unique across the ${scope}. First used at ${existing.path}`, `${path}.id`, node));
  } else {
    map.set(id, { path, node });
  }
}

function isAccessPoint(node) {
  if (!node || node.kind !== 'assignment' || node.value?.valueType !== 'collection') return false;
  const values = node.value.items.filter((item) => item.kind === 'value');
  return values.length >= 2
    && values[0].valueType === 'string'
    && values.slice(1).every((item) => item.valueType === 'string' && item.value.startsWith('.'));
}

function primitive(value) {
  if (!value || value.kind !== 'value') return undefined;
  return value.valueType === 'nell' ? null : value.value;
}

function collectionStrings(value) {
  if (!value || value.valueType !== 'collection') return null;
  const items = value.items.filter((item) => item.kind !== 'comment');
  if (!items.every((item) => item.kind === 'value' && item.valueType === 'string')) return null;
  return items.map((item) => item.value);
}

function walkEntries(entries, visitor, path) {
  entries.forEach((entry, index) => {
    const itemPath = `${path}[${index}]`;
    if (entry.kind === 'assignment') walkValue(entry.value, visitor, `${itemPath}.value`);
  });
}

function walkValue(value, visitor, path) {
  visitor(value, path);
  if (value.valueType === 'array' || value.valueType === 'collection') {
    value.items.forEach((item, index) => {
      const itemPath = `${path}.items[${index}]`;
      if (item.kind === 'assignment') walkValue(item.value, visitor, `${itemPath}.value`);
      else if (item.kind === 'value') walkValue(item, visitor, itemPath);
    });
  }
}

export function assertValid(document, options = {}) {
  const issues = validate(document);
  const blocking = issues.filter((entry) => entry.severity === 'error');
  if (blocking.length > 0) throw new RedXaiValidationError(issues);
  if (options.warningsAsErrors && issues.length > 0) throw new RedXaiValidationError(issues);
  return issues;
}

export function validateProject(documents) {
  const issues = [];
  const ids = new Map();
  documents.forEach((document, documentIndex) => {
    for (const current of validate(document)) issues.push({ ...current, path: `$project[${documentIndex}]${current.path.slice(1)}` });
    document.databases?.forEach((database, databaseIndex) => {
      collectAssignments(database.entries, (assignment, assignmentPath) => {
        if (assignment.id == null || assignment.id <= 1) return;
        const path = `$project[${documentIndex}].databases[${databaseIndex}]${assignmentPath}`;
        const existing = ids.get(assignment.id);
        if (existing) issues.push(issue('RXH170', `Project duplicate ID ${assignment.id}; first used at ${existing}`, path, assignment));
        else ids.set(assignment.id, path);
      }, '.entries');
    });
  });
  return issues;
}

function collectDocumentIds(document) {
  const ids = new Set();
  document.databases.forEach((database) => {
    collectAssignments(database.entries, (assignment) => {
      if (Number.isInteger(assignment.id) && assignment.id > 1) ids.add(assignment.id);
    }, '.entries');
  });
  return ids;
}

function collectAssignments(entries, callback, path) {
  entries.forEach((entry, index) => {
    if (entry.kind !== 'assignment') return;
    const currentPath = `${path}[${index}]`;
    callback(entry, currentPath);
    if (entry.value.valueType === 'array') collectAssignments(entry.value.items, callback, `${currentPath}.value.items`);
  });
}

export { isAccessPoint };
