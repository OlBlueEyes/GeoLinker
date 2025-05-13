import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ImportOsmDataService } from './import-osm-data.service';
import { ImportOsmDataController } from './import-osm-data.controller';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from 'src/common/common.module';

@Module({
  imports: [HttpModule, ConfigModule, CommonModule],
  providers: [ImportOsmDataService],
  controllers: [ImportOsmDataController],
  exports: [ImportOsmDataService],
})
export class ImportOsmDataModule {}
