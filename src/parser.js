import { tokenize } from './lexer.js';
import { RedXaiSyntaxError } from './errors.js';

const canonicalKey = (value) => value.toLowerCase();

export class Parser {
  constructor(source) {
    this.source = source;
    this.tokens = tokenize(source);
    this.current = 0;
  }

  parseDocument() {
    const databases = [];
    while (!this.check('EOF')) {
      databases.push(this.parseDatabase());
    }
    if (databases.length === 0) this.error(this.peek(), 'A RedXai document must contain at least one database');
    return { kind: 'document', format: 'RedXaiHM', databases };
  }

  parseDatabase() {
    const start = this.consume('LBRACE', "Expected '{' to begin a database").start;
    const name = this.consume('IDENTIFIER', 'Expected RedXaiStore database header');
    if (name.value !== 'RedXaiStore') this.error(name, 'Database header must be exactly RedXaiStore');

    this.consume('LBRACKET', "Expected '[' after RedXaiStore");
    const header = this.parseHeaderProperties();
    this.consume('RBRACKET', "Expected ']' after database header");
    this.consume('EQUALS', "Expected '=' after database header");
    this.consume('LBRACKET', "Expected '[' before database contents");

    const entries = this.parseEntrySequence('RBRACKET');
    this.consume('RBRACKET', "Expected ']' after database contents");

    const metadata = this.parseDatabaseMetadata();
    this.consume('RBRACE', "Expected '}' after database metadata");
    const end = this.consume('SEMICOLON', "Expected ';' after database").end;

    return {
      kind: 'database',
      name: 'RedXaiStore',
      id: header.id,
      version: header.version,
      headerExtras: header.extras,
      entries,
      metadata,
      location: { start, end },
    };
  }

  parseHeaderProperties() {
    let id;
    let version = '0.1';
    const extras = {};

    while (!this.check('RBRACKET') && !this.check('EOF')) {
      const key = this.consume('IDENTIFIER', 'Expected database header property');
      this.consume('EQUALS', `Expected '=' after ${key.value}`);
      const value = this.parseScalarValue();
      const normalized = canonicalKey(key.value);
      if (normalized === 'id') id = scalarToPrimitive(value);
      else if (normalized === 'version') version = String(scalarToPrimitive(value));
      else extras[key.value] = value;
      if (!this.match('COMMA')) break;
    }

    if (id === undefined) this.error(this.peek(), 'Database header requires ID=1');
    return { id, version, extras };
  }

  parseEntrySequence(terminator) {
    const entries = [];
    while (!this.check(terminator) && !this.check('EOF')) {
      if (this.match('COMMA')) continue;
      if (this.check('COMMENT')) entries.push(this.parseComment());
      else entries.push(this.parseAssignment());
      this.match('COMMA');
    }
    return entries;
  }

  parseAssignment() {
    const start = this.consume('LBRACE', "Expected '{' to begin a variable").start;
    const name = this.consume('IDENTIFIER', 'Expected variable name');
    this.consume('LBRACKET', "Expected '[' after variable name");
    const id = this.parseOptionalId();
    this.consume('RBRACKET', "Expected ']' after variable ID");
    this.consume('RBRACE', "Expected '}' after variable declaration");
    this.consume('EQUALS', "Expected '=' before variable value");
    const value = this.parseValue();
    return {
      kind: 'assignment',
      name: name.value,
      id,
      value,
      location: { start, end: value.location?.end ?? this.previous().end },
    };
  }

  parseOptionalId() {
    if (this.check('RBRACKET')) return null;
    if (this.check('NUMBER')) return this.advance().value;
    const key = this.consume('IDENTIFIER', 'Expected a numeric ID or ID=<number>');
    if (canonicalKey(key.value) !== 'id') this.error(key, 'Named variable ID must use ID=<number>');
    this.consume('EQUALS', "Expected '=' after ID");
    return this.consume('NUMBER', 'Expected numeric ID').value;
  }

  parseValue() {
    if (this.check('STRING')) {
      const token = this.advance();
      return valueNode('string', token.value, token);
    }
    if (this.check('NUMBER')) {
      const token = this.advance();
      if (this.match('PERCENT')) {
        return { kind: 'value', valueType: 'percent', value: token.value, location: { start: token.start, end: this.previous().end } };
      }
      return valueNode('number', token.value, token);
    }
    if (this.check('IDENTIFIER')) return this.parseIdentifierValue();
    if (this.match('SEMICOLON')) return this.parseArray(this.previous().start);
    if (this.check('LBRACE')) return this.parseCollection();
    if (this.match('AT')) return this.parseReference(this.previous().start);
    this.error(this.peek(), 'Expected a RedXai value');
  }

  parseScalarValue() {
    const value = this.parseValue();
    if (value.valueType === 'array' || value.valueType === 'collection') {
      this.error(this.previous(), 'Expected a scalar value');
    }
    return value;
  }

  parseIdentifierValue() {
    const token = this.advance();
    const normalized = canonicalKey(token.value);
    if (normalized === 'true' || normalized === 'false') {
      return valueNode('boolean', normalized === 'true', token);
    }
    if (normalized === 'nell') {
      const end = this.match('DOLLAR') ? this.previous().end : token.end;
      return { kind: 'value', valueType: 'nell', value: null, location: { start: token.start, end } };
    }
    return valueNode('symbol', token.value, token);
  }

  parseArray(start) {
    this.consume('LBRACKET', "Expected '[' after ';' to begin an array");
    const items = [];
    while (!this.check('RBRACKET') && !this.check('EOF')) {
      if (this.match('COMMA')) continue;
      if (this.check('COMMENT')) items.push(this.parseComment());
      else if (this.looksLikeAssignment()) items.push(this.parseAssignment());
      else items.push(this.parseValue());
      this.match('COMMA');
    }
    this.consume('RBRACKET', "Expected ']' after array");
    const end = this.consume('COLON', "Expected ':' after array").end;
    return { kind: 'value', valueType: 'array', items, location: { start, end } };
  }

  parseCollection() {
    const start = this.consume('LBRACE', "Expected '{' to begin a collection").start;
    const items = [];
    while (!this.check('RBRACE') && !this.check('EOF')) {
      if (this.match('COMMA')) continue;
      if (this.check('COMMENT')) items.push(this.parseComment());
      else items.push(this.parseValue());
      this.match('COMMA');
    }
    const end = this.consume('RBRACE', "Expected '}' after collection").end;
    return { kind: 'value', valueType: 'collection', items, location: { start, end } };
  }

  parseReference(start) {
    if (this.check('NUMBER')) {
      const token = this.advance();
      return { kind: 'value', valueType: 'reference', target: { type: 'id', value: token.value }, location: { start, end: token.end } };
    }
    const token = this.consume('IDENTIFIER', "Expected an ID or name after '@'");
    return { kind: 'value', valueType: 'reference', target: { type: 'name', value: token.value }, location: { start, end: token.end } };
  }

  parseComment() {
    const token = this.consume('COMMENT', 'Expected comment');
    return { kind: 'comment', style: token.style, value: token.value, location: { start: token.start, end: token.end } };
  }

  parseDatabaseMetadata() {
    if (this.checkIdentifier('metadata')) {
      this.advance();
      this.consume('EQUALS', "Expected '=' after Metadata");
      return this.parseNamedMetadata();
    }
    if (this.check('RBRACE')) return defaultMetadata();
    return this.parseLegacyMetadata();
  }

  parseNamedMetadata() {
    this.consume('LBRACE', "Expected '{' after Metadata=");
    const raw = {};
    while (!this.check('RBRACE') && !this.check('EOF')) {
      if (this.match('COMMA')) continue;
      const key = this.consume('IDENTIFIER', 'Expected metadata property');
      this.consume('EQUALS', `Expected '=' after ${key.value}`);
      raw[key.value] = this.parseValue();
      this.match('COMMA');
    }
    this.consume('RBRACE', "Expected '}' after metadata properties");
    return normalizeMetadata(raw);
  }

  parseLegacyMetadata() {
    const shared = this.parseValue();
    this.consume('COMMA', "Expected ',' after shared flag");
    const shareId = this.parseValue();
    this.consume('COMMA', "Expected ',' after share ID");

    if (this.checkIdentifier('opfnames') && this.peek(1).type === 'EQUALS') {
      this.advance();
      this.advance();
    }
    const projectFiles = this.parseValue();
    this.consume('COMMA', "Expected ',' after OPFNames");

    if (this.checkIdentifier('ga') && this.peek(1).type === 'EQUALS') {
      this.advance();
      this.advance();
    }
    const globalAccess = this.parseValue();
    this.consume('COMMA', "Expected ',' after global access flag");

    if (this.checkIdentifier('id') && this.peek(1).type === 'EQUALS') {
      this.advance();
      this.advance();
    }
    const globalId = this.parseValue();

    return {
      shared,
      shareId,
      allowedProjectFiles: projectFiles,
      globalAccess,
      globalId,
      extras: {},
      syntax: 'legacy',
    };
  }

  looksLikeAssignment() {
    return this.check('LBRACE') && this.peek(1).type === 'IDENTIFIER' && this.peek(2).type === 'LBRACKET';
  }

  checkIdentifier(value) {
    return this.check('IDENTIFIER') && canonicalKey(this.peek().value) === canonicalKey(value);
  }

  match(...types) {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  consume(type, message) {
    if (this.check(type)) return this.advance();
    this.error(this.peek(), message);
  }

  check(type) {
    return this.peek().type === type;
  }

  advance() {
    if (!this.check('EOF')) this.current += 1;
    return this.previous();
  }

  peek(offset = 0) {
    return this.tokens[Math.min(this.current + offset, this.tokens.length - 1)];
  }

  previous() {
    return this.tokens[this.current - 1];
  }

  error(token, message) {
    throw new RedXaiSyntaxError(message, token.start);
  }
}

function valueNode(valueType, value, token) {
  return { kind: 'value', valueType, value, location: { start: token.start, end: token.end } };
}

function scalarToPrimitive(node) {
  if (node.valueType === 'nell') return null;
  return node.value;
}

function defaultMetadata() {
  return {
    shared: { kind: 'value', valueType: 'boolean', value: false },
    shareId: { kind: 'value', valueType: 'nell', value: null },
    allowedProjectFiles: { kind: 'value', valueType: 'nell', value: null },
    globalAccess: { kind: 'value', valueType: 'boolean', value: false },
    globalId: { kind: 'value', valueType: 'nell', value: null },
    extras: {},
    syntax: 'canonical',
  };
}

function normalizeMetadata(raw) {
  const result = defaultMetadata();
  const extras = {};
  for (const [key, value] of Object.entries(raw)) {
    const normalized = canonicalKey(key);
    if (normalized === 'shared') result.shared = value;
    else if (normalized === 'shareid' || normalized === 'projectid') result.shareId = value;
    else if (normalized === 'opfnames' || normalized === 'allowedprojectfiles') result.allowedProjectFiles = value;
    else if (normalized === 'ga' || normalized === 'globalaccess') result.globalAccess = value;
    else if (normalized === 'globalid' || normalized === 'id') result.globalId = value;
    else extras[key] = value;
  }
  result.extras = extras;
  return result;
}

export function parse(source) {
  return new Parser(source).parseDocument();
}

export function parseValue(source) {
  const parser = new Parser(`{RedXaiStore[ID=1]=[{Value[]}= ${source}]};`);
  return parser.parseDocument().databases[0].entries[0].value;
}
