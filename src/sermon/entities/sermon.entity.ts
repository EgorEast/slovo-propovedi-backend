import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { PlaylistSermonJoinEntity } from 'src/playlist/entities/playlist-sermon-join.entity';

@Entity('sermon')
export class SermonEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'title', type: 'varchar' })
  title: string;

  @Column({ name: 'description', type: 'varchar' })
  description: string;

  @Column({ name: 'text-file-url', type: 'varchar', nullable: true })
  textFileUrl?: string;

  @Column({ name: 'audio-url', type: 'varchar', nullable: true })
  audioUrl?: string;

  @Column({ name: 'youtube-url', type: 'varchar', nullable: true })
  youtubeUrl?: string;

  @Column({ name: 'artist', type: 'varchar' })
  artist: string;

  @Column({ name: 'artwork', type: 'varchar' })
  artwork: string;

  @Column({ name: 'book', type: 'varchar', nullable: true })
  book?: string;

  @Column({ name: 'chapter', type: 'int', nullable: true })
  chapter?: number;

  @Column({ name: 'verse', type: 'json', nullable: true })
  verse?: number | number[];

  @OneToMany(() => PlaylistSermonJoinEntity, (join) => join.sermon, {
    cascade: true,
  })
  playlistJoins: PlaylistSermonJoinEntity[];
}
