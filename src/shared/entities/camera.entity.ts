import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('datahub_0430.camera')
export class Camera {
  @PrimaryGeneratedColumn('increment', { type: 'int' })
  id: number;

  @Column({ type: 'varchar', length: 255 })
  model: string;

  @Column({ type: 'int' })
  resolution_width: number;

  @Column({ type: 'int' })
  resolution_height: number;

  @Column({ type: 'double precision' })
  frame_rate: number;

  @Column({ type: 'int' })
  equipment_id: number;

  @Column({ type: 'int' })
  heading_offset: number;
}
