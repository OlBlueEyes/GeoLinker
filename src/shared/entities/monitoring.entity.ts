import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('datahub_0430.monitoring')
export class Monitoring {
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

  @Column({ type: 'double precision' })
  altitude: number;

  @Column({ type: 'timestamptz' })
  time: Date;

  @Column({ type: 'smallint' })
  logging_status: number;

  @Column({ type: 'smallint' })
  detector_status: number;

  @Column({ type: 'smallint' })
  gnss_status: number;

  @Column({ type: 'int' })
  record_id: number;
}
