import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { Point } from 'typeorm';

@Entity('datahub_0430.node')
export class Node {
  @PrimaryGeneratedColumn('increment', { type: 'int' })
  id: number;

  @Column('geometry', {
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: true,
  })
  geom: Point;
}
