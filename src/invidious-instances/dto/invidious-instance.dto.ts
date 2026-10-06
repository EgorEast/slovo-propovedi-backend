import { createZodDto } from 'nestjs-zod';
import { InvidiousInstancesControllerFindAllResponseItem } from '../../generated';

export class InvidiousInstanceDto extends createZodDto(
  InvidiousInstancesControllerFindAllResponseItem,
) {}
