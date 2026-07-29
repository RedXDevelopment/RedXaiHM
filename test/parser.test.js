import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, parseValue, serialize, tokenize } from '../src/index.js';

const canonical = `{RedXaiStore[ID=1, Version="0.1"]=[
  << access comment
  {Access[ID=5032]} = {"RedX - abcdefghijklmnop", ".js", ".py"},
  {BoolLower[ID=2]} = false,
  {BoolUpper[ID=3]} = TRUE,
  {Integer[ID=4]} = 25,
  {Decimal[ID=5]} = 26.8,
  {Percent[ID=6]} = 20%,
  {Text[ID=7]} = "this is a string",
  {EmptyLater[ID=8]} = NELL$,
  {Outer[ID=9]} = ;[
    "inside",
    ;[1, FALSE, Nell]:,
    {GlobalInside[ID=10]} = "reachable"
  ]:
] Metadata={Shared=FALSE, ShareID=NELL, OPFNames=NELL, GA=FALSE, GlobalID=NELL}};`;

test('lexer recognizes comments, percentages, and RedX punctuation', () => {
  const tokens = tokenize('<< hi\n{A[ID=2]}=20%');
  assert.equal(tokens[0].type, 'COMMENT');
  assert.equal(tokens.find((token) => token.type === 'PERCENT').value, '%');
  assert.ok(tokens.some((token) => token.type === 'LBRACKET'));
});

test('parser supports all original primitive spellings and nested arrays', () => {
  const document = parse(canonical);
  const entries = document.databases[0].entries.filter((entry) => entry.kind === 'assignment');
  assert.equal(entries[1].value.value, false);
  assert.equal(entries[2].value.value, true);
  assert.equal(entries[3].value.value, 25);
  assert.equal(entries[4].value.value, 26.8);
  assert.equal(entries[5].value.valueType, 'percent');
  assert.equal(entries[6].value.value, 'this is a string');
  assert.equal(entries[7].value.valueType, 'nell');
  assert.equal(entries[8].value.valueType, 'array');
  assert.equal(entries[8].value.items[1].valueType, 'array');
  assert.equal(entries[8].value.items[2].id, 10);
});

test('parser accepts compact IDs and variables without IDs', () => {
  const source = `{RedXaiStore[ID=1]=[{A[2]}=1,{B[]}="local"]FALSE,NELL,NELL,FALSE,NELL};`;
  const entries = parse(source).databases[0].entries;
  assert.equal(entries[0].id, 2);
  assert.equal(entries[1].id, null);
});

test('parser accepts original positional metadata', () => {
  const source = `{RedXaiStore[ID=1]=[{A[ID=2]}=1]TRUE,508173,OPFNames={"Game1","Game2"},GA=TRUE,ID=23001};`;
  const metadata = parse(source).databases[0].metadata;
  assert.equal(metadata.syntax, 'legacy');
  assert.equal(metadata.shared.value, true);
  assert.equal(metadata.shareId.value, 508173);
  assert.equal(metadata.allowedProjectFiles.items[0].value, 'Game1');
  assert.equal(metadata.globalAccess.value, true);
  assert.equal(metadata.globalId.value, 23001);
});

test('line and multiline comments are retained', () => {
  const source = `{RedXaiStore[ID=1]=[
<< line comment
<< multiline begins
and continues
>>
{A[ID=2]}=1
]};`;
  const entries = parse(source).databases[0].entries;
  assert.equal(entries[0].style, 'line');
  assert.equal(entries[1].style, 'block');
  assert.match(entries[1].value, /continues/);
});

test('serializer produces canonical named metadata and round-trips', () => {
  const first = parse(canonical);
  const output = serialize(first);
  assert.match(output, /Metadata=\{/);
  assert.match(output, /GlobalID=NELL/);
  const second = parse(output);
  assert.equal(second.databases[0].entries.filter((entry) => entry.kind === 'assignment').length, 9);
});

test('parseValue parses isolated SDK values', () => {
  assert.deepEqual(parseValue('TRUE').value, true);
  assert.equal(parseValue('12.5%').valueType, 'percent');
  assert.equal(parseValue(';[1,"two",NELL]:').items.length, 3);
});

test('database header name and ID syntax are exact', () => {
  assert.throws(() => parse('{redxaistore[ID=1]=[{A[ID=2]}=1]};'), /exactly RedXaiStore/);
  assert.throws(() => parse('{RedXaiStore[1]=[{A[ID=2]}=1]};'), /header property/);
});

test('invalid characters produce location-aware syntax errors', () => {
  assert.throws(() => parse('{RedXaiStore[ID=1]=[{A[ID=2]}=`bad`]};'), /Unexpected character.*1:/);
});
