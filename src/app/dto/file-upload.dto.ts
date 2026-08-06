import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Permissive passthrough for the multipart upload param.
 *
 * The global strict Zod pipe (strictSchemaDeclaration) requires every route
 * param's reflected metatype to be a ZodDto, otherwise it throws a 500. The
 * upload param is an Express.Multer.File, which is a TS interface that erases
 * to `Object` — so it must be annotated with a ZodDto. `z.any()` accepts the
 * Multer file unchanged; presence and type are validated in the controller.
 */
export class FileUploadDto extends createZodDto(z.any()) {}
