import { PartialType } from '@nestjs/mapped-types';
import { CreateSermonDto } from './create-sermon.dto';

export class UpdateSermonDto extends PartialType(CreateSermonDto) {}
