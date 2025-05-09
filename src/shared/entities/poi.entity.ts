import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('datahub_0430.poi')
export class Poi {
  @PrimaryGeneratedColumn('increment', { type: 'int' })
  id: number;

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

  @Column({ type: 'double precision' })
  x_center: number;

  @Column({ type: 'double precision' })
  y_center: number;

  @Column({ type: 'double precision' })
  width: number;

  @Column({ type: 'double precision' })
  height: number;

  @Column({ type: 'int' })
  detection_class_id: number;

  @Column({ type: 'bigint' })
  image_id: string;
}
