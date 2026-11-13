export class DocumentError extends Error {
  constructor(message, status = 'failed') {
    super(message);
    this.status = status;
  }
}
