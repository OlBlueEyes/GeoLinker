import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('datahub_0430.lidar_monitoring')
export class LidarMonitoring {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'smallint' })
  status: number;

  @Column({ type: 'int' })
  lidar_id: number;

  @Column({ type: 'bigint' })
  monitoring_id: string;
}
