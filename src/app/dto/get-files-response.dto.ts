import { createZodDto } from 'nestjs-zod';
import { GetFilesResponse } from '../../generated';

export class GetFilesResponseDto extends createZodDto(GetFilesResponse) {}
