import { Module } from '@nestjs/common';
import { CommonModule } from 'src/common/common.module';
import { MapMatchingService } from './map-matching.service';
import { MapMatchingController } from './map-matching.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Link } from 'src/shared/entities/link.entity';
import { Node } from 'src/shared/entities/node.entity';
import { Frame } from 'src/shared/entities/frame.entity';
import { AdvancedMapMatching } from 'src/common/utils/map-matcher';

@Module({
  imports: [TypeOrmModule.forFeature([Link, Node, Frame]), CommonModule],
  providers: [MapMatchingService, AdvancedMapMatching],
  controllers: [MapMatchingController],
  exports: [MapMatchingService],
})
export class MapMatchingModule {}
