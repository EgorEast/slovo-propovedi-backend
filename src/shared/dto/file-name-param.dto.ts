import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AppControllerGetFileParams } from '../../generated';
import { STORED_FILE_NAME_PATTERN } from '../media';

// Stored objects are named `randomUUID() + <media extension>` (see
// MinioService.uploadFile). Only that shape may reach the storage layer —
// arbitrary strings must not become object keys or be reflected into URLs.
// The extension alternation derives from the shared media taxonomy; the
// generated param schema supplies the strict object boundary.
const FileNameParamSchema = AppControllerGetFileParams.extend({
  fileName: z
    .string()
    .max(255)
    .regex(STORED_FILE_NAME_PATTERN, 'Invalid stored file name'),
});

export class FileNameParamDto extends createZodDto(FileNameParamSchema) {}
