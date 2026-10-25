import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { Socket } from 'socket.io';
import { AppException } from './app.exception.js';
import { ErrorCode, type ErrorResponse } from './error-code.js';

const codeByStatus: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.BAD_REQUEST,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCode.PAYLOAD_TOO_LARGE,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED,
  [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.SERVICE_UNAVAILABLE,
};

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const { status, body } = toErrorResponse(exception);
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR && !(exception instanceof AppException)) {
      this.logger.error(exception);
    }
    if (host.getType() === 'ws') {
      // Same `{ code, details? }` contract as HTTP, on the event socket.io clients already listen to.
      host.switchToWs().getClient<Socket>().emit('exception', body);
      return;
    }
    void host.switchToHttp().getResponse<FastifyReply>().status(status).send(body);
  }
}

function toErrorResponse(exception: unknown): { status: number; body: ErrorResponse } {
  if (exception instanceof AppException) {
    return {
      status: exception.getStatus(),
      body: { code: exception.code, details: exception.details },
    };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return { status, body: { code: codeByStatus[status] ?? fallbackCode(status) } };
  }
  return { status: HttpStatus.INTERNAL_SERVER_ERROR, body: { code: ErrorCode.INTERNAL_ERROR } };
}

function fallbackCode(status: number): ErrorCode {
  return status >= HttpStatus.INTERNAL_SERVER_ERROR
    ? ErrorCode.INTERNAL_ERROR
    : ErrorCode.BAD_REQUEST;
}
