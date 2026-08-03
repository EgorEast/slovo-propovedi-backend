import {
  Column,
  Entity,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PlaylistEntity } from '../../playlist/entities/playlist.entity';

export type ItemsSize = 'small' | 'middle' | 'large' | 'xLarge';
export type Transform = 'high' | 'short';
export type WhereIsSlideTitleLocated = 'on' | 'under' | 'bothOnAndUnder';

@Entity('section')
export class SectionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'title', type: 'varchar' })
  title: string;

  @Column({ name: 'description', type: 'varchar', nullable: true })
  description: string | null;

  @Column({ name: 'items-size', type: 'varchar' })
  itemsSize: ItemsSize;

  @Column({ name: 'items-rows', type: 'int', nullable: true })
  itemsRows?: number | null;

  @Column({ name: 'transform', type: 'varchar' })
  transform: Transform;

  @Column({
    name: 'is-description-title-on-slide-large',
    type: 'boolean',
    default: false,
  })
  isDescriptionTitleOnSlideLarge: boolean;

  @Column({
    name: 'where-is-slide-title-located',
    type: 'varchar',
    default: 'under',
  })
  whereIsSlideTitleLocated: WhereIsSlideTitleLocated;

  @Column({ name: 'border-radius', type: 'boolean', default: false })
  borderRadius: boolean;

  @ManyToMany(() => PlaylistEntity, (playlist) => playlist.sections, {
    onDelete: 'CASCADE',
  })
  @JoinTable()
  playlists: PlaylistEntity[];
}
