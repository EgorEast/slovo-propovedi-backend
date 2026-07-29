import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';

export enum ItemsSize {
  SMALL = 'small',
  MIDDLE = 'middle',
  LARGE = 'large',
  XLARGE = 'xLarge',
}

export enum Transform {
  HIGH = 'high',
  SHORT = 'short',
}

export enum SlideTitleLocation {
  ON = 'on',
  UNDER = 'under',
  BOTH = 'bothOnAndUnder',
}

export class CreateSectionDto {
  @ApiProperty()
  @IsString()
  title: string;

  @ApiProperty()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ enum: ItemsSize })
  @IsEnum(ItemsSize)
  itemsSize: string;

  @ApiProperty()
  @IsInt()
  @IsOptional()
  itemsRows?: number;

  @ApiProperty({ enum: Transform })
  @IsEnum(Transform)
  transform: string;

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
