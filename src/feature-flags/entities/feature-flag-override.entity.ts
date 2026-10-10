import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

// A per-user exception to a flag's global default. At most one row per
// (flag, user) pair — enforced by the composite unique constraint — so the
// effective value or the absence of a row are the only two states.
export type FeatureFlagOverrideValue = 'grant' | 'deny';

@Entity('feature_flag_override')
@Unique('UQ_feature_flag_override_pair', ['flagId', 'userId'])
export class FeatureFlagOverride {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'flag_id', type: 'uuid' })
  flagId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'value', type: 'varchar' })
  value: FeatureFlagOverrideValue;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
