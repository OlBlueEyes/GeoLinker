import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Link } from 'src/shared/entities/link.entity';
import { Node } from 'src/shared/entities/node.entity';
import { Repository, IsNull } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import { getRequiredEnvStr } from 'src/common/utils/get-required-env';

@Injectable()
export class InsertNodeIdService {
  private readonly logger = new Logger(InsertNodeIdService.name);
  public INSERT_ID: string;
  public schema: string;

  constructor(
    @InjectRepository(Node)
    private readonly nodeRepository: Repository<Node>,

    @InjectRepository(Link)
    private readonly linkRepository: Repository<Link>,

    private configService: ConfigService,
  ) {
    this.INSERT_ID = getRequiredEnvStr(this.configService, 'INSERT_ID');
    this.schema = getRequiredEnvStr(this.configService, 'DATABASE_SCHEMA');
  }

  logDatabaseInfo() {
    const dbType = this.configService.get<string>('DB_TYPE');
    const dbHost = this.configService.get<string>('DB_HOST');
    const dbPort = this.configService.get<string>('DB_PORT');
    const dbUsername = this.configService.get<string>('DB_USERNAME');
    const dbDatabase = this.configService.get<string>('DB_DATABASE');

    console.log('Connected to Database:');
    console.log(`Type: ${dbType}`);
    console.log(`Host: ${dbHost}`);
    console.log(`Port: ${dbPort}`);
    console.log(`Username: ${dbUsername}`);
    console.log(`Database Name: ${dbDatabase}`);
    console.log(`Database Schema: ${this.schema}`);
  }

  async insertNodeIds(): Promise<void> {
    this.logDatabaseInfo();

    try {
      const insertProcessStart = this.processStartTime(
        `Insert Node ID In Link`,
      );
      const totalLinks = await this.linkRepository.count({
        where: [{ start_node: IsNull() }, { end_node: IsNull() }],
      });
      this.logger.log(`Total Links to process: ${totalLinks}`);

      // 전체 노드 개수 확인
      const totalNodes = await this.nodeRepository.count();
      this.logger.log(`Total Nodes in database: ${totalNodes}`);

      if (totalLinks === 0) return;

      this.logger.log('Starting process to insert Node IDs into Links.');

      // Start Node 업데이트
      this.logger.log('Updating start_node in link table...');
      const startNodeResult: unknown = await this.linkRepository.query(`
        UPDATE ${this.schema}.link
        SET start_node = sub.node_id
        FROM (
            SELECT l.id AS link_id, n.id AS node_id
            FROM ${this.schema}.link l
            JOIN ${this.schema}.node n
            ON n.geom && ST_Expand(ST_StartPoint(l.geom), 0.00001)
            AND ST_DWithin(ST_StartPoint(l.geom), n.geom, 0.00001)
            
            ORDER BY ST_Distance(ST_StartPoint(l.geom), n.geom) ASC
        ) AS sub
        WHERE ${this.schema}.link.id = sub.link_id;
      `);
      if (
        Array.isArray(startNodeResult) &&
        typeof startNodeResult[1] === 'number'
      ) {
        this.logger.log(`Updated start_node: ${startNodeResult[1]} rows`);
      } else {
        this.logger.warn(
          `Unexpected startNodeResult: ${JSON.stringify(startNodeResult)}`,
        );
      }

      // End Node 업데이트
      this.logger.log('Updating end_node in link table...');
      const endNodeResult: unknown = await this.linkRepository.query(`
        UPDATE ${this.schema}.link
        SET end_node = sub.node_id
        FROM (
            SELECT l.id AS link_id, n.id AS node_id
            FROM ${this.schema}.link l
            JOIN ${this.schema}.node n
            ON n.geom && ST_Expand(ST_EndPoint(l.geom), 0.00001)
            AND ST_DWithin(ST_EndPoint(l.geom), n.geom, 0.00001)
            
            ORDER BY ST_Distance(ST_EndPoint(l.geom), n.geom) ASC
        ) AS sub
        WHERE ${this.schema}.link.id = sub.link_id;
      `);

      if (
        Array.isArray(endNodeResult) &&
        typeof endNodeResult[1] === 'number'
      ) {
        this.logger.log(`Updated end_node: ${endNodeResult[1]} rows`);
      } else {
        this.logger.warn(
          `Unexpected endNodeResult: ${JSON.stringify(endNodeResult)}`,
        );
      }

      this.logger.log('Process to insert Node IDs completed successfully.');
      this.processEndTime(
        `Update of start_node and end_node `,
        insertProcessStart,
      );
    } catch (error: unknown) {
      const errorMsg =
        error instanceof Error ? error.message : JSON.stringify(error);
      this.logger.error(`Error during bulk update: ${errorMsg}`);
      throw new Error('Failed to update node IDs in bulk.');
    }
  }

  // 로그 메시지를 기록하는 함수

  private logToFile(message: string, filePath: string) {
    console.log(message);
    const logmsg = `${new Date().toISOString()} - ${message}`;
    fs.appendFileSync(filePath, logmsg + '\n');
  }

  private processStartTime(funcName: string): number {
    const processStartMessage = `Start ${funcName}`;
    console.log(processStartMessage);
    this.logToFile(processStartMessage, this.INSERT_ID);
    return Date.now(); // 시작 시간을 반환
  }

  private processEndTime(funcName: string, startTime: number): void {
    const processEndMessage = `End ${funcName}`;
    console.log(processEndMessage);
    this.logToFile(processEndMessage, this.INSERT_ID);

    const endTime = Date.now();
    const durationMessage = `${funcName} took ${endTime - startTime}ms`;
    console.log(durationMessage);
    this.logToFile(durationMessage, this.INSERT_ID);
  }
}
