import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { UserRole } from '../user-role.enum';

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

  @Column({ name: 'username', type: 'varchar', unique: true })
  @IsNotEmpty()
  @IsString()
  username: string;

  @Column({ name: 'password', type: 'varchar' })
  @IsNotEmpty()
  @IsString()
  password: string;

  @Column({ name: 'role', type: 'varchar', default: UserRole.User })
  role: UserRole;

  // Bumped whenever the password changes; tokens signed with an older version
  // are rejected, so a password change revokes every outstanding session.
  @Column({ name: 'token_version', type: 'integer', default: 0 })
  tokenVersion: number;
}
