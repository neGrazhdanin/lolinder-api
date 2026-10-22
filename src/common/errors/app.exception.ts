import { HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorCode } from './error-code.js';

export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    status: HttpStatus,
    readonly details?: unknown,
  ) {
    super(code, status);
  }
}
