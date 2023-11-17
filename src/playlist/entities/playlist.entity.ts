import { IsOptional, IsString } from 'class-validator';
import { SectionEntity } from 'src/section/entities/section.entity';
import { Column, Entity, ManyToMany, PrimaryGeneratedColumn } from 'typeorm';

@Entity('playlist')
export class PlaylistEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'title', type: 'varchar' })
  @IsString()
  title: string;

  @Column({ name: 'description', type: 'varchar', nullable: true })
  @IsString()
  description: string;

  @ManyToMany(() => SectionEntity, (section) => section.playlists)
  @IsOptional()
  sections: SectionEntity[];
}
