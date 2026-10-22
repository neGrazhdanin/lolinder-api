import { HttpStatus, StandardSchemaValidationPipe } from '@nestjs/common';
import { AppException } from '../errors/app.exception.js';
import { ErrorCode } from '../errors/error-code.js';

export function createSchemaValidationPipe(): StandardSchemaValidationPipe {
  return new StandardSchemaValidationPipe({
    exceptionFactory: (issues) =>
      new AppException(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        issues.map((issue) => ({
          path: (issue.path ?? [])
            .map((segment) => (typeof segment === 'object' ? segment.key : segment))
            .join('.'),
          message: issue.message,
        })),
      ),
  });
}
