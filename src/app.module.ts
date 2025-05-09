import { Module } from '@nestjs/common';
import * as path from 'path';
import { TypeOrmConfigService } from './config/typeorm.config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ImportOsmDataModule } from './modules/import-osm-data/import-osm-data.module';
import { SplitOsmDataModule } from './modules/split-osm-data/split-osm-data.module';
import { InsertNodeIdModule } from './modules/insert-node-id/insert-node-id.module';
import { MapMatchingModule } from './modules/map-matching/map-matching.module';

const envFilePath = path.resolve(
  process.cwd(),
  `.env.${process.env.NODE_ENV || 'local'}`,
);

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: [envFilePath],
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      useClass: TypeOrmConfigService,
    }),
    ImportOsmDataModule,
    SplitOsmDataModule,
    InsertNodeIdModule,
    MapMatchingModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
