import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SplitOsmDataService } from './split-osm-data.service';
import { SplitOsmDataController } from './split-osm-data.controller';

@Module({
  imports: [ConfigModule],
  providers: [SplitOsmDataService],
  controllers: [SplitOsmDataController],
  exports: [SplitOsmDataService],
})
export class SplitOsmDataModule {}
