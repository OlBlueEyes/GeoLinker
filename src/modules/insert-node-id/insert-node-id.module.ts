import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { InsertNodeIdService } from './insert-node-id.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Node } from 'src/shared/entities/node.entity';
import { Link } from 'src/shared/entities/link.entity';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([Node, Link])],
  providers: [InsertNodeIdService],
  exports: [InsertNodeIdService],
})
export class InsertNodeIdModule {}
