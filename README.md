# RedXaiHM

RedXaiHM is RedXDevelopment's ID-centric, human-readable database language and long-term storage engine. It stores durable application data in `.RedXai` files and is designed around stable numeric identities, strict validation, transactional writes, and official SDK access.

> Status: early development. The language and storage format are not yet production-stable.

## Core design

- Every database begins with a required `RedXaiStore` header whose ID is `1`.
- IDs are unique inside a database; `0` is never valid.
- Values may omit IDs and remain local to their containing structure.
- `NELL` is the explicit unassigned/non-existent value.
- Arrays may contain values, variables, and nested arrays.
- Access points can restrict SDK languages and external projects.
- `.RedXai` is the official file extension.

## First milestone

The initial TypeScript reference implementation includes the lexer, parser, AST, validator, serializer, in-memory ID index, transactional file store, command-line interface, examples, and tests.

## License

Apache-2.0. See `LICENSE`.
