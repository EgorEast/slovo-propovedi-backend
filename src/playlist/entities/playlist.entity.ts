import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { SectionPlaylistJoinEntity } from 'src/section/entities/section-playlist-join.entity';
import { PlaylistSermonJoinEntity } from './playlist-sermon-join.entity';

@Entity('playlist')
export class PlaylistEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'title', type: 'varchar' })
  title: string;

  @Column({ name: 'description', type: 'varchar' })
  description: string;

  @Column({ name: 'artwork', type: 'varchar' })
  artwork: string;

  @OneToMany(() => SectionPlaylistJoinEntity, (join) => join.playlist, {
    cascade: true,
  })
  sectionJoins: SectionPlaylistJoinEntity[];

  @OneToMany(() => PlaylistSermonJoinEntity, (join) => join.playlist, {
    cascade: true,
  })
  sermonJoins: PlaylistSermonJoinEntity[];
}
