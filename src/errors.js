export class RedXaiSyntaxError extends SyntaxError {
  constructor(message, location) {
    const suffix = location ? ` at ${location.line}:${location.column}` : '';
    super(`${message}${suffix}`);
    this.name = 'RedXaiSyntaxError';
    this.location = location ?? null;
  }
}

export class RedXaiValidationError extends Error {
  constructor(issues) {
    super(`RedXai validation failed with ${issues.length} issue${issues.length === 1 ? '' : 's'}`);
    this.name = 'RedXaiValidationError';
    this.issues = issues;
  }
}

export class RedXaiStorageError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'RedXaiStorageError';
  }
}
