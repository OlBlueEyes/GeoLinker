import { IsOptional } from 'class-validator';
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('datahub_0430.pointcloud')
export class Pointcloud {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @IsOptional()
  @Column({ type: 'varchar', length: 1024 })
  path: string | null;

  @Column({ type: 'bigint' })
  frame_id: string;

  @Column({ type: 'int' })
  lidar_id: number;
}
