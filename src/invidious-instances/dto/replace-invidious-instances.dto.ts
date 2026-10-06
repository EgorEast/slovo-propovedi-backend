import { createZodDto } from 'nestjs-zod';
import { InvidiousInstancesControllerReplaceBody } from '../../generated';

export class ReplaceInvidiousInstancesDto extends createZodDto(
  InvidiousInstancesControllerReplaceBody,
) {}
