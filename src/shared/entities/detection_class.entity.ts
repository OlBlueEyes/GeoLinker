import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('datahub_0430.detection_class')
export class DetectionClass {
  @PrimaryGeneratedColumn('increment', { type: 'int' })
  id: number;

  @Column({ type: 'varchar', length: 255 })
  name_en: string;

  @Column({ type: 'int', nullable: true })
  parent_class_id: number;

  @Column({ type: 'varchar', length: 255 })
  name_ko: string;
}
