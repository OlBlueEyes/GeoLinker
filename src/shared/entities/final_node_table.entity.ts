import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { Point } from 'typeorm';

@Entity('datahub_0430.final_node_table')
export class FinalNodeTable {
  @PrimaryGeneratedColumn('increment', { type: 'int' })
  id: number;

  @Column('geometry', {
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: true,
  })
  geom: Point;
}
