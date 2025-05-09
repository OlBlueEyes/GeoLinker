import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('datahub_0430.camera_monitoring')
export class CameraMonitoring {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'smallint' })
  status: number;

  @Column({ type: 'int' })
  camera_id: number;

  @Column({ type: 'bigint' })
  monitoring_id: string;
}
