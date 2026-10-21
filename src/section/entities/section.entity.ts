import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { SectionPlaylistJoinEntity } from './section-playlist-join.entity';

export type ItemsSize = 'small' | 'middle' | 'large' | 'xLarge';
export type Transform = 'high' | 'short' | 'middle';
/**
 * Where the section slide title is rendered.
 *
 * `'on'` — centered over the artwork. `'under'` — caption below the card.
 * `'bothOnAndUnder'` — title and description stacked at the bottom of the card
 * (title above the description). The DB value string is kept for backward
 * compatibility with existing rows.
 */
export type WhereIsSlideTitleLocated = 'on' | 'under' | 'bothOnAndUnder';

@Entity('section')
export class SectionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'title', type: 'varchar' })
  title: string;

  @Column({ name: 'description', type: 'varchar', nullable: true })
  description: string | null;

  // Global order of sections (drag-and-drop reordering on the admin dashboard).
  @Column({ name: 'position', type: 'integer', nullable: false, default: 0 })
  position: number;

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

  @OneToMany(() => SectionPlaylistJoinEntity, (join) => join.section, {
    cascade: true,
  })
  playlistJoins: SectionPlaylistJoinEntity[];
}
