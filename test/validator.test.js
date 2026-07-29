import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, validate, validateProject, assertValid } from '../src/index.js';

function codes(source) {
  return validate(parse(source)).map((item) => item.code);
}

test('valid canonical account database has no validation errors', () => {
  const source = `{RedXaiStore[ID=1]=[
{Access[ID=9]}={"RedX - abcdefghijklmnop", ".js"},
{Accounts[ID=10]}=;[{Email[ID=11]}="a@example.com"]:
]FALSE,NELL,NELL,FALSE,NELL};`;
  assert.equal(validate(parse(source)).filter((item) => item.severity === 'error').length, 0);
});

test('database header must be ID 1', () => {
  assert.ok(codes('{RedXaiStore[ID=2]=[{A[ID=3]}=1]};').includes('RXH101'));
});

test('0 and 1 are invalid variable IDs', () => {
  const result = codes('{RedXaiStore[ID=1]=[{A[ID=0]}=1,{B[ID=1]}=2]};');
  assert.equal(result.filter((code) => code === 'RXH112').length, 2);
});

test('duplicate IDs are rejected across nested arrays and databases', () => {
  const source = `{RedXaiStore[ID=1]=[{A[ID=2]}=;[{Nested[ID=7]}=1]:]};
{RedXaiStore[ID=1]=[{Again[ID=7]}=2]};`;
  assert.ok(codes(source).includes('RXH113'));
  assert.throws(() => assertValid(parse(source)), /validation failed/i);
});

test('access points must appear before ordinary values', () => {
  const source = `{RedXaiStore[ID=1]=[
{Data[ID=2]}=1,
{LateAccess[ID=3]}={"RedX - abcdefghijklmnop", ".js"}
]};`;
  assert.ok(codes(source).includes('RXH130'));
});

test('shared database requires share metadata and file names', () => {
  const source = `{RedXaiStore[ID=1]=[{A[ID=2]}=1] Metadata={Shared=TRUE,ShareID=NELL,OPFNames=NELL,GA=FALSE,GlobalID=NELL}};`;
  const result = codes(source);
  assert.ok(result.includes('RXH142'));
  assert.ok(result.includes('RXH143'));
});

test('global database requires numeric ID greater than 1', () => {
  const source = `{RedXaiStore[ID=1]=[{A[ID=2]}=1] Metadata={Shared=FALSE,ShareID=NELL,OPFNames=NELL,GA=TRUE,GlobalID=1}};`;
  assert.ok(codes(source).includes('RXH144'));
});

test('unresolved references are rejected', () => {
  const source = `{RedXaiStore[ID=1]=[{A[ID=2]}=@999,{B[ID=3]}=@Missing]};`;
  const result = codes(source);
  assert.ok(result.includes('RXH150'));
  assert.ok(result.includes('RXH151'));
});

test('forward references can target IDs declared in a later database', () => {
  const source = `{RedXaiStore[ID=1]=[{Pointer[ID=2]}=@50]};\n{RedXaiStore[ID=1]=[{Later[ID=50]}="ok"]};`;
  assert.ok(!codes(source).includes('RXH150'));
});

test('project validator rejects IDs reused in separate files', () => {
  const one = parse('{RedXaiStore[ID=1]=[{A[ID=20]}=1]};');
  const two = parse('{RedXaiStore[ID=1]=[{B[ID=20]}=2]};');
  assert.ok(validateProject([one, two]).some((item) => item.code === 'RXH170'));
});
