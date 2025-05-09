import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('datahub_0430.frame_tag')
export class FrameTag {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'bigint' })
  frame_id: string;

  @Column({ type: 'int' })
  tag_id: number;
}
