import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SectionEntity } from './section.entity';
import { PlaylistEntity } from '../../playlist/entities/playlist.entity';

@Entity('section_playlists_playlist')
export class SectionPlaylistJoinEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'sectionId', type: 'uuid' })
  sectionId: string;

  @Column({ name: 'playlistId', type: 'uuid' })
  playlistId: string;

  @Column({ type: 'integer', nullable: false, default: 0 })
  position: number;

  @ManyToOne(() => SectionEntity, (section) => section.playlistJoins, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'sectionId' })
  section: SectionEntity;

  @ManyToOne(() => PlaylistEntity, (playlist) => playlist.sectionJoins, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'playlistId' })
  playlist: PlaylistEntity;
}
