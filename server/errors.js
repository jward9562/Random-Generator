// Only these deliberately written messages may cross the server/browser boundary.
export class PublicError extends Error {
  constructor(code, message, status = 503) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
