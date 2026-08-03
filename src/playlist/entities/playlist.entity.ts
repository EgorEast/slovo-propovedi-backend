import { SectionEntity } from 'src/section/entities/section.entity';
import { SermonEntity } from 'src/sermon/entities/sermon.entity';
import {
  Column,
  Entity,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

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

  @ManyToMany(() => SectionEntity, (section) => section.playlists, {
    onDelete: 'CASCADE',
  })
  sections: SectionEntity[];

  @ManyToMany(() => SermonEntity, (sermon) => sermon.playlists, {
    onDelete: 'CASCADE',
  })
  @JoinTable()
  sermons: SermonEntity[];
}
