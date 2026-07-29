# RedXaiHM Language Specification — Draft 0.1

This document defines the behavior implemented by the JavaScript reference engine. It refines the original RedXaiHM design without replacing its core syntax or identity rules.

## 1. Files

A RedXaiHM database uses the exact extension `.RedXai`. Files are UTF-8 in version 0.1. Official tools must refuse to save another extension.

A document contains one or more databases. Every database begins with a `RedXaiStore` header. The first non-whitespace token of a document must begin a database header.

## 2. Database header

Canonical form:

```redxai
{RedXaiStore[ID=1, Version="0.1"]=[
```

Rules:

1. The header name and casing must be exactly `RedXaiStore`.
2. Every database header ID is exactly `1`.
3. ID `0` is invalid everywhere.
4. Header ID `1` may repeat only because each database requires it.
5. `Version` is optional while parsing and defaults to `0.1`; the serializer always writes it.

## 3. Variables and IDs

Canonical variable form:

```redxai
{Name[ID=25]} = "value"
```

Accepted compact forms:

```redxai
{Name[25]} = "value"
{Name[]} = "local value"
```

An omitted ID makes the variable local and not directly available through global ID APIs. A supplied ID must be an integer greater than `1` and unique regardless of whether the value is a string, number, Boolean, array, access point, or another type.

The reference validator checks uniqueness across every database in one document. `validateProject()` checks multiple documents and is the foundation for a future project-wide ID catalog.

## 4. Values

### 4.1 Boolean

All of the following parse identically:

```redxai
TRUE
True
true
FALSE
False
false
```

Canonical output uses `TRUE` and `FALSE`.

### 4.2 Number

Integers, decimals, negative values, and scientific notation are supported as one numeric family:

```redxai
25
26.8
-4
1.5e6
```

### 4.3 Percentage

A number immediately followed by `%` is represented as the distinct `percent` value type while retaining its written amount:

```redxai
20%
```

### 4.4 String

Strings use double quotes and JSON-compatible escapes:

```redxai
"this is a string"
"line one\nline two"
```

### 4.5 NELL

`NELL` is RedXaiHM's explicit non-existent or not-yet-assigned value. `NELL`, `Nell`, `nell`, and the original `NELL$` spelling are accepted. Canonical output is `NELL`.

### 4.6 Symbol

A bare identifier used as a value is a symbol:

```redxai
DB23
```

Strings are preferred for secrets, filenames, and arbitrary text.

### 4.7 Reference

References point to an ID or name:

```redxai
@25
@PrimaryAccount
```

Unresolved references are validation errors.

## 5. Arrays

Arrays use the original RedXaiHM delimiters:

```redxai
{Players[ID=5]} = ;[
  "Player One",
  4,
  TRUE,
  NELL,
  ;["nested", FALSE]:
]:
```

Arrays can contain scalar values, collections, nested arrays, comments, and complete variables. A variable inside an array with an ID is indexed at database scope and can be reached directly through SDK operations.

```redxai
{Accounts[ID=10]} = ;[
  {Email[ID=11]} = "owner@example.com"
]:
```

## 6. Collections and access points

Collections use braces:

```redxai
{"Game1", "Game2", "Game3"}
```

An assignment is recognized as an access point when its collection contains an API-key string followed by one or more language-extension strings:

```redxai
{AnyVariableName[ID=5032]} = {
  "RedX - 0647gd6j4496hjt",
  ".js",
  ".py",
  ".cs",
  ".cpp",
  ".c",
  ".lua"
}
```

Access points must appear before normal stored values. Their names are not reserved. In version 0.1, API keys are required to be quoted, and extension entries must begin with a period.

Language restrictions are policy metadata. Applications and SDK gateways are responsible for enforcing them; a file extension alone is not a security boundary.

## 7. Comments

Single-line comment:

```redxai
<< comment text
```

Multiline comment:

```redxai
<<
comment line one
comment line two
>>
```

For compatibility with the original examples, a `<<` comment containing text may continue until `>>` when no newer `<<` begins first. Comments are retained in the AST and canonical serialization.

## 8. Database metadata

Canonical closing block:

```redxai
] Metadata={
  Shared=TRUE,
  ShareID=508173,
  OPFNames={"Game1", "Game2", "Game3"},
  GA=TRUE,
  GlobalID=23001
}};
```

Original positional closing syntax is accepted:

```redxai
]TRUE, 508173, OPFNames={"Game1", "Game2"}, GA=TRUE, ID=23001};
```

Private database:

```redxai
]FALSE, NELL, NELL, FALSE, NELL};
```

Rules:

- `Shared=TRUE` requires a non-`NELL` share ID and at least one allowed project filename.
- `GA=TRUE` requires a numeric global ID greater than `1`.
- Global APIs expose only values that carry IDs. Local values without IDs remain unavailable through global ID lookup.
- A future project catalog will enforce unique share IDs and global IDs across separate repositories and services.

## 9. Reading order and scope

Within a database, entries are read from top to bottom. Variables with IDs inside arrays are indexed at database scope. Across a document, globally accessible databases are intended to be indexed before private databases by higher-level runtimes; the 0.1 parser preserves source order and leaves policy ordering to the application layer.

## 10. Transactions and storage

The reference file store:

1. Parses and validates before writing.
2. Acquires an exclusive lock file.
3. Copies the current database to `.bak` when backups are enabled.
4. Writes a same-directory temporary file with mode `0600`.
5. Flushes the file.
6. Atomically renames it over the target.
7. Attempts to flush the containing directory.
8. Removes the lock.

If the primary file fails to load, recovery may use the validated `.bak` file. This mechanism protects against interrupted writes; it is not encryption or tamper-proof authentication.

## 11. Canonical operations

The first SDK exposes ID-focused operations matching the original design:

- `getById(id)`
- `setById(id, value)`
- `renameById(id, name)`
- `deleteById(id)`
- `copyById(id, options)`
- `moveById(id, targetArrayId, index)`
- `transaction(callback)`

The editor and all future SDKs must produce behavior equivalent to the reference implementation.
