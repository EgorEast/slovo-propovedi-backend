import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

// A remotely toggled feature. `key` is the stable identifier the client checks
// (`read`, `study`, …); `enabled` is the global default for every user. Per-user
// exceptions live in FeatureFlagOverride.
@Entity('feature_flag')
@Unique('UQ_feature_flag_key', ['key'])
export class FeatureFlag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'key', type: 'varchar' })
  key: string;

  @Column({ name: 'title', type: 'varchar' })
  title: string;

  @Column({ name: 'enabled', type: 'boolean', default: false })
  enabled: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
