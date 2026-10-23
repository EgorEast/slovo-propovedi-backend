import { InternalServerErrorException, Logger } from '@nestjs/common';

const INTERNAL_ERROR_MESSAGE = 'Internal server error';

// Unexpected failures (pg driver, TypeORM, MinIO) must never leak their text
// to the client: driver messages can carry SQL fragments, relation names and
// constraint names. The full detail is logged with the `from:<operation>`
// correlation prefix; the response body stays generic.
export function toInternalServerError(
  logger: Logger,
  operation: string,
  error: unknown,
): InternalServerErrorException {
  const detail = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  logger.error(`from:${operation} ${detail}`, stack);

  return new InternalServerErrorException(INTERNAL_ERROR_MESSAGE);
}
