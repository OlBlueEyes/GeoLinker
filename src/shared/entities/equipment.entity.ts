import { Column, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

@Entity('datahub_0430.equipment')
export class Equipment {
  @PrimaryGeneratedColumn('increment', { type: 'int' })
  id: number;

  @Column({ type: 'int' })
  asset_code: number;

  @Column({ type: 'smallint' })
  type: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  gnss_model: string;

  @Column({ type: 'varchar', length: 255 })
  sync_device_model: string;

  @Column({ type: 'json' })
  calib: any;
}
