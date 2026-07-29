import { PartialType } from '@nestjs/mapped-types';
import { CreateSectionDto, ItemsSize, Transform, SlideTitleLocation } from './create-section.dto';
import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateSectionDto extends PartialType(CreateSectionDto) {
  @ApiProperty()
  @IsArray()
  @IsOptional()
  playlistsIds?: string[];

  @ApiProperty({ enum: ItemsSize })
  @IsEnum(ItemsSize)
  @IsOptional()
  itemsSize?: string;

  @ApiProperty()
  @IsInt()
  @IsOptional()
  itemsRows?: number;

  @ApiProperty({ enum: Transform })
  @IsEnum(Transform)
  @IsOptional()
  transform?: string;

  @ApiProperty()
  @IsBoolean()
  @IsOptional()
  isDescriptionTitleOnSlideLarge?: boolean;

  @ApiProperty({ enum: SlideTitleLocation })
  @IsEnum(SlideTitleLocation)
  @IsOptional()
  whereIsSlideTitleLocated?: string;

  @ApiProperty()
  @IsBoolean()
  @IsOptional()
  borderRadius?: boolean;
}
