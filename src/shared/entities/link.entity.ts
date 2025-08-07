import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  JoinColumn,
  LineString,
} from 'typeorm';

@Entity('datahub_0430.link')
export class Link {
  @PrimaryGeneratedColumn('increment', { type: 'int' })
  id: number;

  @Column('geometry', {
    spatialFeatureType: 'LineString',
    srid: 4326,
    nullable: true,
  })
  geom: LineString;

  @Column({ type: 'varchar' })
  osm_id: string;

  @Column({ type: 'varchar' })
  osm_type: string;

  @Column({ type: 'varchar', nullable: true })
  oneway: string;

  @Column({ type: 'varchar', nullable: true })
  @JoinColumn({ name: 'name_ko' })
  name_ko: string;

  @Column({ type: 'varchar', nullable: true })
  @JoinColumn({ name: 'name_en' })
  name_en: string;

  @Column({ type: 'varchar' })
  highway: string;

  @Column({ type: 'int' })
  source: number;

  @Column({ type: 'int' })
  target: number;
}
