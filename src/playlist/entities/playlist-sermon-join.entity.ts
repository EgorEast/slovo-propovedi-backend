import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PlaylistEntity } from './playlist.entity';
import { SermonEntity } from '../../sermon/entities/sermon.entity';

@Entity('playlist_sermons_sermon')
export class PlaylistSermonJoinEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'playlistId', type: 'uuid' })
  playlistId: string;

  @Column({ name: 'sermonId', type: 'uuid' })
  sermonId: string;

  @Column({ type: 'integer', nullable: false, default: 0 })
  position: number;

  @ManyToOne(() => PlaylistEntity, (playlist) => playlist.sermonJoins, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'playlistId' })
  playlist: PlaylistEntity;

  @ManyToOne(() => SermonEntity, (sermon) => sermon.playlistJoins, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'sermonId' })
  sermon: SermonEntity;
}
