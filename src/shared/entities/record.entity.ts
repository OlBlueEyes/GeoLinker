import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity('datahub_0430.record')
export class Record {
  @PrimaryGeneratedColumn('increment', { type: 'int' })
  id: number;

  @Column({ type: 'timestamptz' })
  start_time: Date;

  @Column({ type: 'timestamptz' })
  end_time: Date;

  @Column({ type: 'smallint' })
  epsg_code: number;

  @Column({ type: 'smallint' })
  height_type: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  geoid_model: string;

  @Column({ type: 'smallint' })
  traj_type: number;

  @Column({ type: 'varchar', length: 1024 })
  record_path: string;

  @Column({ type: 'smallint' })
  car_number: number;

  @Column({ type: 'double precision' })
  rot_y: number;

  @Column({ type: 'int' })
  equipment_id: number;

  @Column({ type: 'varchar' })
  detection_model: string;
}
