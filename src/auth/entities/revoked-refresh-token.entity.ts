import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

// One row per revoked refresh token. The denylist is keyed by the sha256 hash
// of the token (never the token itself), so a leaked database dump cannot be
// replayed as a valid refresh token.
@Entity('revoked_refresh_token')
export class RevokedRefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'token_hash', type: 'varchar', unique: true })
  tokenHash: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'revoked_at', type: 'timestamptz', default: () => 'now()' })
  revokedAt: Date;

  // Mirror of the token's own `exp` claim — once past this point the token is
  // expired anyway, so the row is garbage (purged opportunistically on logout).
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;
}
