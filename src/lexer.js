import { RedXaiSyntaxError } from './errors.js';

const SINGLE_CHAR = new Map([
  ['{', 'LBRACE'], ['}', 'RBRACE'], ['[', 'LBRACKET'], [']', 'RBRACKET'],
  ['=', 'EQUALS'], [',', 'COMMA'], [';', 'SEMICOLON'], [':', 'COLON'],
  ['%', 'PERCENT'], ['@', 'AT'], ['$','DOLLAR'],
]);

const isDigit = (ch) => ch >= '0' && ch <= '9';
const isIdentifierStart = (ch) => /[A-Za-z_]/.test(ch ?? '');
const isIdentifierPart = (ch) => /[A-Za-z0-9_\-.]/.test(ch ?? '');

export class Lexer {
  constructor(source) {
    this.source = source.replace(/^\uFEFF/, '');
    this.index = 0;
    this.line = 1;
    this.column = 1;
  }

  tokenize() {
    const tokens = [];
    while (!this.isAtEnd()) {
      const ch = this.peek();
      if (/\s/.test(ch)) {
        this.consumeWhitespace();
        continue;
      }
      if (ch === '<' && this.peek(1) === '<') {
        tokens.push(this.readComment());
        continue;
      }
      if (ch === '"') {
        tokens.push(this.readString());
        continue;
      }
      if (isDigit(ch) || (ch === '-' && isDigit(this.peek(1)))) {
        tokens.push(this.readNumber());
        continue;
      }
      if (isIdentifierStart(ch)) {
        tokens.push(this.readIdentifier());
        continue;
      }
      const type = SINGLE_CHAR.get(ch);
      if (type) {
        tokens.push(this.makeToken(type, ch, ch.length));
        continue;
      }
      throw new RedXaiSyntaxError(`Unexpected character ${JSON.stringify(ch)}`, this.location());
    }
    tokens.push({ type: 'EOF', value: '', start: this.location(), end: this.location() });
    return tokens;
  }

  readComment() {
    const start = this.location();
    this.advance();
    this.advance();

    const contentStart = this.index;
    const nextClose = this.source.indexOf('>>', this.index);
    const nextOpen = this.source.indexOf('<<', this.index);
    const closesBeforeAnotherOpen = nextClose !== -1 && (nextOpen === -1 || nextClose < nextOpen);

    if (closesBeforeAnotherOpen) {
      while (this.index < nextClose) this.advance();
      const value = this.source.slice(contentStart, nextClose).trim();
      this.advance();
      this.advance();
      return { type: 'COMMENT', value, style: 'block', start, end: this.location() };
    }

    while (!this.isAtEnd() && this.peek() !== '\n') this.advance();
    const value = this.source.slice(contentStart, this.index).trim();
    return { type: 'COMMENT', value, style: 'line', start, end: this.location() };
  }

  readString() {
    const start = this.location();
    this.advance();
    let value = '';
    while (!this.isAtEnd()) {
      const ch = this.advance();
      if (ch === '"') {
        return { type: 'STRING', value, start, end: this.location() };
      }
      if (ch === '\\') {
        if (this.isAtEnd()) break;
        const escaped = this.advance();
        const map = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\', b: '\b', f: '\f' };
        if (escaped === 'u') {
          const hex = this.source.slice(this.index, this.index + 4);
          if (!/^[0-9A-Fa-f]{4}$/.test(hex)) {
            throw new RedXaiSyntaxError('Invalid Unicode escape', this.location());
          }
          value += String.fromCharCode(Number.parseInt(hex, 16));
          for (let i = 0; i < 4; i += 1) this.advance();
        } else if (Object.hasOwn(map, escaped)) {
          value += map[escaped];
        } else {
          throw new RedXaiSyntaxError(`Unsupported escape \\${escaped}`, this.location());
        }
      } else {
        value += ch;
      }
    }
    throw new RedXaiSyntaxError('Unterminated string', start);
  }

  readNumber() {
    const start = this.location();
    const begin = this.index;
    if (this.peek() === '-') this.advance();
    while (isDigit(this.peek())) this.advance();
    if (this.peek() === '.' && isDigit(this.peek(1))) {
      this.advance();
      while (isDigit(this.peek())) this.advance();
    }
    if ((this.peek() === 'e' || this.peek() === 'E')) {
      const mark = this.index;
      this.advance();
      if (this.peek() === '+' || this.peek() === '-') this.advance();
      if (!isDigit(this.peek())) {
        this.index = mark;
        this.recomputeLocation();
      } else {
        while (isDigit(this.peek())) this.advance();
      }
    }
    const raw = this.source.slice(begin, this.index);
    return { type: 'NUMBER', value: Number(raw), raw, start, end: this.location() };
  }

  readIdentifier() {
    const start = this.location();
    const begin = this.index;
    this.advance();
    while (isIdentifierPart(this.peek())) this.advance();
    const value = this.source.slice(begin, this.index);
    return { type: 'IDENTIFIER', value, start, end: this.location() };
  }

  consumeWhitespace() {
    while (!this.isAtEnd() && /\s/.test(this.peek())) this.advance();
  }

  makeToken(type, value, length) {
    const start = this.location();
    for (let i = 0; i < length; i += 1) this.advance();
    return { type, value, start, end: this.location() };
  }

  peek(offset = 0) {
    return this.source[this.index + offset];
  }

  advance() {
    const ch = this.source[this.index++];
    if (ch === '\n') {
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }
    return ch;
  }

  isAtEnd() {
    return this.index >= this.source.length;
  }

  location() {
    return { offset: this.index, line: this.line, column: this.column };
  }

  recomputeLocation() {
    const prefix = this.source.slice(0, this.index);
    const lines = prefix.split('\n');
    this.line = lines.length;
    this.column = lines.at(-1).length + 1;
  }
}

export function tokenize(source) {
  return new Lexer(source).tokenize();
}
