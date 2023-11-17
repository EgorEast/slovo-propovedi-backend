import {
  Column,
  Entity,
  JoinColumn,
  ManyToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { IsOptional, IsString } from 'class-validator';
import { PlaylistEntity } from '../../playlist/entities/playlist.entity';

@Entity('section')
export class SectionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'title', type: 'varchar' })
  @IsString()
  title: string;

  @Column({ name: 'description', type: 'varchar', nullable: true })
  @IsString()
  description: string;

  @ManyToMany(() => PlaylistEntity, (playlist) => playlist.sections)
  @JoinColumn()
  @IsOptional()
  playlists: PlaylistEntity[];
}
