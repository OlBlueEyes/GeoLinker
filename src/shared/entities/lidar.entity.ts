import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('datahub_0430.lidar')
export class Lidar {
  @PrimaryGeneratedColumn('increment', { type: 'int' })
  id: number;

  @Column({ type: 'varchar', length: 255 })
  model: string;

  @Column({ type: 'double precision' })
  rpm: number;

  @Column({ type: 'varchar', length: 255 })
  return_type: string;

  @Column({ type: 'int' })
  equipment_id: number;
}
