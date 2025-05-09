import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ImportOsmDataService } from './import-osm-data.service';
import { ImportOsmDataController } from './import-osm-data.controller';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [HttpModule, ConfigModule],
  providers: [ImportOsmDataService],
  controllers: [ImportOsmDataController],
  exports: [ImportOsmDataService],
})
export class ImportOsmDataModule {}
