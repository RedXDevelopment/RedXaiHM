# RedXaiHM

RedXaiHM is RedXDevelopment's ID-centric database language and long-term storage engine. It stores durable application data in files with the exact `.RedXai` extension and is intended for accounts, permissions, API keys, OAuth records, settings, billing state, and other important data that must survive for years.

> **Development status:** `0.1.0-alpha.1`. The parser, validator, storage engine, SDK surface, CLI, and first editor are functional, but the format is not yet production-stable and encryption is intentionally reserved for a later RedX Crypt milestone.

## What makes it RedXaiHM

- Every database begins with `{RedXaiStore[ID=1 ...]=[`.
- `0` is never a valid ID. `1` is reserved for the database header.
- IDs on values are optional, but every supplied ID must be unique across the document/project.
- `NELL`, in any letter case, is the explicit unassigned/non-existent value.
- Arrays use the RedXai form `;[ ... ]:` and may contain values, variables, comments, and nested arrays.
- Variables inside arrays remain addressable by ID anywhere in the database scope.
- Access points can pair an API key with allowed language extensions.
- Shared-project and global-access metadata are built into the database closing block.
- The engine supplies fast ID lookup, rename, edit, copy, move, delete, transactions, atomic saves, backups, and stale-lock recovery.

## Canonical example

```redxai
{RedXaiStore[ID=1, Version="0.1"]=[
  << Access points are declared before normal stored values.
  {MailAccess[ID=5032]} = {"RedX - replace-this-key", ".js", ".py", ".cs"},

  {Accounts[ID=10]} = ;[
    {Account[ID=11]} = ;[
      {Email[ID=12]} = "owner@redxaimail.com",
      {Verified[ID=13]} = TRUE,
      {RecoveryEmail[ID=14]} = NELL
    ]:
  ]:
] Metadata={
  Shared=FALSE,
  ShareID=NELL,
  OPFNames=NELL,
  GA=FALSE,
  GlobalID=NELL
}};
```

The parser also accepts the original positional closing form:

```redxai
]FALSE, NELL, NELL, FALSE, NELL};
```

The serializer always writes the clearer named metadata form.

## Install and use

RedXaiHM currently has no runtime dependencies and requires Node.js 20.11 or newer.

```bash
npm install
npm test
node ./src/cli.js validate ./examples/accounts.RedXai
node ./src/cli.js edit ./examples/accounts.RedXai
```

SDK example:

```js
import { RedXaiFileStore } from '@redxdevelopment/redxaihm';

const store = new RedXaiFileStore();
const loaded = await store.load('./Accounts.RedXai');

loaded.database.transaction((db) => {
  db.setById(13, true);
  db.renameById(14, 'BackupEmail');
});

await store.save('./Accounts.RedXai', loaded.database.document);
```

## Official editing path

`.RedXai` files are associated with the RedXaiHM Editor through `scripts/register-windows.ps1`. The initial editor runs locally on `127.0.0.1`, validates every save through the reference parser, and writes through the atomic storage engine. The operating system cannot make a text-based format mathematically impossible to open in another program; future encrypted containers will make unauthorized direct editing impractical. Until then, the supported write paths are the editor, CLI, and SDK.

## Repository map

- `src/lexer.js` — comments, strings, numbers, symbols, punctuation.
- `src/parser.js` — source to AST, including legacy metadata compatibility.
- `src/validator.js` — ID, metadata, access-point, reference, and project rules.
- `src/serializer.js` — canonical `.RedXai` source writer.
- `src/database.js` — indexed operations and transactions.
- `src/store.js` — locks, backups, atomic writes, and recovery.
- `src/editor-server.js` and `editor/` — official local editor.
- `docs/SPECIFICATION.md` — language rules.
- `test/` — reference behavior tests.

## Security boundary

This alpha does **not** invent or claim custom encryption. Passwords must be stored as strong password hashes, and sensitive fields should remain protected by the application until RedX Crypt adds authenticated encryption based on reviewed cryptographic primitives.

## License

Apache-2.0.
