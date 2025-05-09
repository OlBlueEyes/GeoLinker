import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('datahub_0430.image')
export class Image {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 1024 })
  path: string;

  @Column({ type: 'bigint' })
  frame_id: string;

  @Column({ type: 'int' })
  camera_id: number;
}
