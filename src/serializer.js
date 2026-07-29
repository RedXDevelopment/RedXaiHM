const indentText = (level, size) => ' '.repeat(level * size);

export function serialize(document, options = {}) {
  const indentSize = options.indent ?? 2;
  const newline = options.newline ?? '\n';
  return document.databases
    .map((database) => serializeDatabase(database, indentSize, newline))
    .join(`${newline}${newline}`) + newline;
}

function serializeDatabase(database, indentSize, newline) {
  const headerParts = [`ID=${database.id}`, `Version=${quote(database.version)}`];
  for (const [key, value] of Object.entries(database.headerExtras ?? {})) {
    headerParts.push(`${key}=${serializeValue(value, 0, indentSize, newline)}`);
  }

  const lines = [`{RedXaiStore[${headerParts.join(', ')}]=[`];
  for (let i = 0; i < database.entries.length; i += 1) {
    const entry = database.entries[i];
    const rendered = serializeEntry(entry, 1, indentSize, newline);
    const comma = entry.kind === 'assignment' && hasFollowingContent(database.entries, i) ? ',' : '';
    lines.push(rendered + comma);
  }
  lines.push(`] Metadata={`);
  lines.push(`${indentText(1, indentSize)}Shared=${serializeValue(database.metadata.shared, 1, indentSize, newline)},`);
  lines.push(`${indentText(1, indentSize)}ShareID=${serializeValue(database.metadata.shareId, 1, indentSize, newline)},`);
  lines.push(`${indentText(1, indentSize)}OPFNames=${serializeValue(database.metadata.allowedProjectFiles, 1, indentSize, newline)},`);
  lines.push(`${indentText(1, indentSize)}GA=${serializeValue(database.metadata.globalAccess, 1, indentSize, newline)},`);
  lines.push(`${indentText(1, indentSize)}GlobalID=${serializeValue(database.metadata.globalId, 1, indentSize, newline)}${Object.keys(database.metadata.extras ?? {}).length ? ',' : ''}`);
  const extras = Object.entries(database.metadata.extras ?? {});
  extras.forEach(([key, value], index) => {
    lines.push(`${indentText(1, indentSize)}${key}=${serializeValue(value, 1, indentSize, newline)}${index < extras.length - 1 ? ',' : ''}`);
  });
  lines.push(`}};`);
  return lines.join(newline);
}

function serializeEntry(entry, level, indentSize, newline) {
  if (entry.kind === 'comment') return serializeComment(entry, level, indentSize, newline);
  const id = entry.id == null ? '' : `ID=${entry.id}`;
  const prefix = `${indentText(level, indentSize)}{${entry.name}[${id}]} = `;
  return prefix + serializeValue(entry.value, level, indentSize, newline);
}

export function serializeValue(value, level = 0, indentSize = 2, newline = '\n') {
  switch (value.valueType) {
    case 'string': return quote(value.value);
    case 'number': return String(value.value);
    case 'percent': return `${value.value}%`;
    case 'boolean': return value.value ? 'TRUE' : 'FALSE';
    case 'nell': return 'NELL';
    case 'symbol': return value.value;
    case 'reference': return `@${value.target.value}`;
    case 'collection': return serializeCollection(value, level, indentSize, newline);
    case 'array': return serializeArray(value, level, indentSize, newline);
    default: throw new TypeError(`Cannot serialize unknown RedXai value type: ${value.valueType}`);
  }
}

function serializeCollection(value, level, indentSize, newline) {
  const content = value.items.filter((item) => item.kind !== 'comment');
  if (content.length === 0) return '{}';
  if (content.every((item) => item.kind === 'value' && !['array', 'collection'].includes(item.valueType))) {
    return `{${content.map((item) => serializeValue(item, level, indentSize, newline)).join(', ')}}`;
  }
  const lines = ['{'];
  value.items.forEach((item, index) => {
    const rendered = item.kind === 'comment'
      ? serializeComment(item, level + 1, indentSize, newline)
      : `${indentText(level + 1, indentSize)}${serializeValue(item, level + 1, indentSize, newline)}`;
    lines.push(rendered + (item.kind !== 'comment' && hasFollowingContent(value.items, index) ? ',' : ''));
  });
  lines.push(`${indentText(level, indentSize)}}`);
  return lines.join(newline);
}

function serializeArray(value, level, indentSize, newline) {
  if (value.items.length === 0) return ';[]:';
  const lines = [';['];
  value.items.forEach((item, index) => {
    let rendered;
    if (item.kind === 'assignment' || item.kind === 'comment') rendered = serializeEntry(item, level + 1, indentSize, newline);
    else rendered = `${indentText(level + 1, indentSize)}${serializeValue(item, level + 1, indentSize, newline)}`;
    lines.push(rendered + (item.kind !== 'comment' && hasFollowingContent(value.items, index) ? ',' : ''));
  });
  lines.push(`${indentText(level, indentSize)}]:`);
  return lines.join(newline);
}

function serializeComment(comment, level, indentSize, newline) {
  const indent = indentText(level, indentSize);
  if (comment.style === 'block' || comment.value.includes('\n')) {
    const body = comment.value.split('\n').map((line) => `${indent}${line}`).join(newline);
    return `${indent}<<${newline}${body}${newline}${indent}>>`;
  }
  return `${indent}<< ${comment.value}`;
}

function quote(value) {
  return JSON.stringify(String(value));
}

function hasFollowingContent(items, index) {
  return items.slice(index + 1).some((item) => item.kind !== 'comment');
}
