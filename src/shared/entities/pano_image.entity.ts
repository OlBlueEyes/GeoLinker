import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('datahub_0430.pano_image')
export class PanoImage {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 1024 })
  path: string;

  @Column({ type: 'bigint' })
  frame_id: string;

  @Column({ type: 'int' })
  omni_camera_id: number;
}
