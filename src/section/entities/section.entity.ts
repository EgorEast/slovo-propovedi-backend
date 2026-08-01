import {
  Column,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { IsOptional, IsString } from 'class-validator';
import { PlaylistEntity } from '../../playlist/entities/playlist.entity';
import { ApiProperty } from '@nestjs/swagger';

@Entity('section')
export class SectionEntity {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column({ name: 'title', type: 'varchar' })
  @IsString()
  title: string;

  @ApiProperty()
  @Column({ name: 'description', type: 'varchar', nullable: true })
  @IsString()
  description: string;

  @ApiProperty()
  @Column({ name: 'items-size', type: 'varchar' })
  itemsSize: string;

  @ApiProperty()
  @Column({ name: 'items-rows', type: 'int', nullable: true })
  itemsRows?: number;

  @ApiProperty()
  @Column({ name: 'transform', type: 'varchar' })
  transform: string;

  @ApiProperty({ default: false })
  @Column({
    name: 'is-description-title-on-slide-large',
    type: 'boolean',
    default: false,
  })
  isDescriptionTitleOnSlideLarge: boolean;

  @ApiProperty({ default: 'under' })
  @Column({
    name: 'where-is-slide-title-located',
    type: 'varchar',
    default: 'under',
  })
  whereIsSlideTitleLocated: string;

  @ApiProperty({ default: false })
  @Column({ name: 'border-radius', type: 'boolean', default: false })
  borderRadius: boolean;

  @ApiProperty({ type: () => PlaylistEntity, isArray: true })
  @ManyToMany(() => PlaylistEntity, (playlist) => playlist.sections, {
    onDelete: 'CASCADE',
  })
  @JoinTable()
  playlists: PlaylistEntity[];
}
