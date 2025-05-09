import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('datahub_0430.omni_camera_monitoring')
export class OmniCameraMonitoring {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'smallint' })
  status: number;

  @Column({ type: 'int' })
  omni_camera_id: number;

  @Column({ type: 'bigint' })
  monitoring_id: string;
}
