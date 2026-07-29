# RedXaiHM Roadmap

## 0.1 — reference core

- Language specification
- Lexer, parser, AST, and canonical serializer
- Original positional metadata compatibility
- ID and metadata validation
- In-memory ID index
- Find, edit, rename, move, copy, and delete operations
- Transactions
- Atomic file storage, locks, backups, and recovery
- CLI and local official editor
- Windows `.RedXai` association and Red X icon
- Node.js SDK

## 0.2 — schemas and migrations

- Optional schemas
- Required and constrained fields
- Unique indexes beyond IDs
- Version migration declarations
- Query filters and pagination
- Transaction journal and recovery tests
- Performance benchmark suite

## 0.3 — identity service integration

- RedX Identity service adapter
- Migration tooling from the existing SQLite account store
- Dual-write and verification period before cutover
- Session, OAuth, API-key, and audit databases
- Production backup and restore exercises

## Later — RedX Crypt

- Authenticated encrypted `.RedXai` containers
- Key rotation and per-field encryption
- Recovery keys
- Integrity signatures
- Secret-redaction support in the editor and CLI
