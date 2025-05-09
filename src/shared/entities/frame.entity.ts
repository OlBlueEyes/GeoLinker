import { H3Index } from 'h3-js';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('datahub_0430.frame')
export class Frame {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({
    type: 'geometry',
    nullable: true,
    spatialFeatureType: 'Point',
    srid: 4326,
  })
  geom: {
    type: string;
    coordinates: number[];
  };

  @Column()
  h3_index: H3Index;

  @Column({ type: 'double precision', nullable: true })
  easting: number;

  @Column({ type: 'double precision', nullable: true })
  northing: number;

  @Column({ type: 'double precision', nullable: true })
  up: number;

  @Column({ type: 'double precision', nullable: true })
  roll: number;

  @Column({ type: 'double precision', nullable: true })
  pitch: number;

  @Column({ type: 'double precision', nullable: true })
  yaw: number;

  @Column({ type: 'double precision', nullable: true })
  east_vel: number;

  @Column({ type: 'double precision', nullable: true })
  north_vel: number;

  @Column({ type: 'double precision', nullable: true })
  up_vel: number;

  @Column({ type: 'double precision', nullable: true })
  east_sd: number;

  @Column({ type: 'double precision', nullable: true })
  north_sd: number;

  @Column({ type: 'double precision', nullable: true })
  up_sd: number;

  @Column({ type: 'double precision', nullable: true })
  roll_sd: number;

  @Column({ type: 'double precision', nullable: true })
  pitch_sd: number;

  @Column({ type: 'double precision', nullable: true })
  heading_sd: number;

  @Column({ type: 'double precision', nullable: true })
  x_ang_vel: number;

  @Column({ type: 'double precision', nullable: true })
  y_ang_vel: number;

  @Column({ type: 'double precision', nullable: true })
  z_ang_vel: number;

  @Column({ type: 'timestamp', nullable: true })
  time: Date;

  @Column({ type: 'int', nullable: true })
  gps_week_number: number;

  @Column({ type: 'double precision', nullable: true })
  gps_week_second: number;

  @Column({ type: 'int' })
  record_id: number;

  @Column({ type: 'smallint' })
  bf_code: number;

  @Column({ type: 'varchar', length: 30 })
  s2_index: string;

  @Column({ type: 'int' })
  link_id: number;
}
