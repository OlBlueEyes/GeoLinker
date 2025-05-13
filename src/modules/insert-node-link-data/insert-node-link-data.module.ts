import { Module } from '@nestjs/common';
import { InsertNodeLinkDataService } from './insert-node-link-data.service';
import { InsertNodeLinkDataController } from './insert-node-link-data.controller';
import { LoggingUtil } from 'src/common/utils/logger.util';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinalNodeTable } from 'src/shared/entities/final_node_table.entity';
import { FinalLinkTable } from 'src/shared/entities/final_link_table.entity';
import { Frame } from 'src/shared/entities/frame.entity';
import { EnvConfigService } from 'src/config/env-config.service';

@Module({
  imports: [TypeOrmModule.forFeature([FinalNodeTable, FinalLinkTable, Frame])],
  providers: [InsertNodeLinkDataService, LoggingUtil, EnvConfigService],
  controllers: [InsertNodeLinkDataController],
})
export class InsertNodeLinkDataModule {}
