import * as path from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TypeOrmConfigService } from './config/typeorm.config';
import { ImportOsmDataModule } from './modules/import-osm-data/import-osm-data.module';
import { SplitOsmDataModule } from './modules/split-osm-data/split-osm-data.module';
import { MapMatchingModule } from './modules/map-matching/map-matching.module';
import { WinstonModule } from 'nest-winston';
// import { winstonLoggerOptions } from './common/logger/winston.config';
import { winstonLoggerFactory } from './common/logger/logger.module';
import { EnvConfigService } from './config/env-config.service';
import { WinstonModuleOptions } from 'nest-winston';
import { EnvConfigModule } from './config/env-config.module';
import { InsertNodeLinkDataModule } from './modules/insert-node-link-data/insert-node-link-data.module';

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
    WinstonModule.forRootAsync({
      imports: [EnvConfigModule],
      useFactory: (envConfigService: EnvConfigService): WinstonModuleOptions =>
        winstonLoggerFactory(envConfigService),
      inject: [EnvConfigService],
    }),
    ImportOsmDataModule,
    SplitOsmDataModule,
    MapMatchingModule,
    EnvConfigModule,
    InsertNodeLinkDataModule,
  ],
  controllers: [],
  providers: [EnvConfigService],
})
export class AppModule {}
