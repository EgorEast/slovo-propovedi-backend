import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('user')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'name', type: 'varchar' })
  @IsNotEmpty()
  name: string;

  @Column({ name: 'email', type: 'varchar', unique: true })
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @Column({ name: 'password', type: 'varchar' })
  @IsNotEmpty()
  @IsString()
  password: string;
}
