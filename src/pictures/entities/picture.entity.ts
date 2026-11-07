import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('picture')
export class PictureEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'picture-path', type: 'varchar' })
  picturePath: string;

  @Column({ name: 'blurhash', type: 'varchar', nullable: true })
  blurhash: string | null;
}
