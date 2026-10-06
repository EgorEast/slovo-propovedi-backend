import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

// A single Invidious instance the mobile import form offers as a preset.
// `id` is an auto-incrementing integer (not a uuid): the client only uses it
// as a stable React key, and its ascending order doubles as the display order.
@Entity('invidious_instance')
export class InvidiousInstanceEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'url', type: 'varchar', unique: true })
  url: string;
}
