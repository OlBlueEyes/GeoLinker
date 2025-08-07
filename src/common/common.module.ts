import { Module } from '@nestjs/common';
import { LoggingUtil } from '../modules/map-matching/utils/logger.util';
import { EnvConfigService } from 'src/config/env-config.service';
import { MapMatchingHelper } from 'src/modules/map-matching/utils/map-matching-helper';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Frame } from 'src/shared/entities/frame.entity';
import { Node } from 'src/shared/entities/node.entity';
import { Link } from 'src/shared/entities/link.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Frame, Node, Link])],
  providers: [LoggingUtil, EnvConfigService, MapMatchingHelper],
  exports: [LoggingUtil, EnvConfigService, MapMatchingHelper],
})
export class CommonModule {}
