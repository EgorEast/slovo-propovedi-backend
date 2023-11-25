import {
  Column,
  Entity,
  JoinColumn,
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

  @ApiProperty({ type: PlaylistEntity, isArray: true })
  @ManyToMany(() => PlaylistEntity, (playlist) => playlist.sections)
  @JoinColumn()
  @IsOptional()
  playlists: PlaylistEntity[];
}
