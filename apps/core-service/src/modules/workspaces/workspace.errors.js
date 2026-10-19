export class WorkspaceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'WorkspaceError';
    this.status = status;
    this.code = code;
  }
}
