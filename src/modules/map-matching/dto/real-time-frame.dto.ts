import { H3Index } from 'h3-js';

export interface RealTimeFrameDto {
  id: string;

  geom: {
    type: 'Point';
    coordinates: [number, number];
  };

  h3_index: H3Index;

  easting: number;

  northing: number;

  up: number;

  roll: number;

  pitch: number;

  yaw: number;

  east_vel: number;

  north_vel: number;

  up_vel: number;

  x_ang_vel: number;

  y_ang_vel: number;

  z_ang_vel: number;

  sensor_time: string;

  record_id: number;

  link_id?: number;
}
