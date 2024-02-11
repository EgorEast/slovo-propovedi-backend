import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PlaylistEntity } from 'src/playlist/entities/playlist.entity';
import { Column, Entity, ManyToMany, PrimaryGeneratedColumn } from 'typeorm';

@Entity('sermon')
export class SermonEntity {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column({ name: 'title', type: 'varchar' })
  @IsString()
  title: string;

  @ApiProperty()
  @Column({ name: 'description', type: 'varchar' })
  @IsString()
  description: string;

  @ApiProperty()
  @Column({ name: 'text-file-url', type: 'varchar', nullable: true })
  @IsString()
  @IsOptional()
  textFileUrl?: string;

  @ApiProperty()
  @Column({ name: 'audio-url', type: 'varchar', nullable: true })
  @IsString()
  @IsOptional()
  audioUrl?: string;

  @ApiProperty()
  @Column({ name: 'youtube-url', type: 'varchar', nullable: true })
  @IsString()
  @IsOptional()
  youtubeUrl?: string;

  @ApiProperty({ type: () => PlaylistEntity, isArray: true })
  @ManyToMany(() => PlaylistEntity, (playlist) => playlist.sermons, {
    onDelete: 'CASCADE',
  })
  playlists: PlaylistEntity[];
}
