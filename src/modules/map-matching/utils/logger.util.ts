import * as fs from 'fs';
import * as path from 'path';
import { Repository } from 'typeorm';
// import { Injectable, Logger } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Frame } from 'src/shared/entities/frame.entity';
import { EnvConfigService } from 'src/config/env-config.service';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Inject } from '@nestjs/common';
import { Logger } from 'winston';

@Injectable()
export class LoggingUtil {
  @Inject(WINSTON_MODULE_PROVIDER)
  private readonly logger: Logger;
  // private readonly logger = new Logger(LoggingUtil.name);

  constructor(
    @InjectRepository(Frame)
    private readonly frameRepository: Repository<Frame>,

    private readonly envConfigService: EnvConfigService,
  ) {}

  logInsert(message: string, level: 'info' | 'warn' | 'error' = 'info') {
    const taggedMessage = `[INSERT] ${message}`;
    this.logger[level](taggedMessage);
  }

  logSplit(message: string, level: 'info' | 'warn' | 'error' = 'info') {
    const taggedMessage = `[SPLIT] ${message}`;
    this.logger[level](taggedMessage);
  }

  logMatching(message: string, level: 'info' | 'warn' | 'error' = 'info') {
    const taggedMessage = `[MATCHING] ${message}`;
    this.logger[level](taggedMessage);
  }

  async logDatabaseInfo() {
    const dbType = this.envConfigService.dbType;
    const dbHost = this.envConfigService.dbHost;
    const dbPort = this.envConfigService.dbPort;
    const dbUsername = this.envConfigService.dbUsername;
    const dbDatabase = this.envConfigService.dbDatabase;
    this.logger.info('Connected to Database:');
    this.logger.info(`DB Type: ${dbType}`);
    this.logger.info(`Host: ${dbHost}`);
    this.logger.info(`Port: ${dbPort}`);
    this.logger.info(`Username: ${dbUsername}`);
    this.logger.info(`Database Name: ${dbDatabase}`);

    // 현재 사용 중인 스키마 확인 쿼리
    const currentSchemaQuery = `
         SHOW search_path;
     `;
    await this.frameRepository.query(
      `SET search_path TO ${this.envConfigService.schema}, public;`,
    );
    try {
      type SchemaQueryResult = { search_path: string };

      const result = (await this.frameRepository.query(
        currentSchemaQuery,
      )) as SchemaQueryResult[];

      // 결과는 일반적으로 `"$user", public` 형태로 반환되므로 처리
      const searchPath = result[0]?.search_path || '';

      this.logger.info(`Current Schema (search_path) : ${searchPath}`);
      this.logToFile(
        `Current Schema (search_path) : ${searchPath}`,
        this.envConfigService.matchedLog,
      );
      // 개별 스키마를 분리하여 출력
      const schemas = searchPath.split(',').map((schema) => schema.trim());
      this.logger.info('Schemas in search_path:');
      schemas.forEach((schema, index) => {
        this.logger.info(`${index + 1}. ${schema}`);
      });
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Failed to fetch schema information:${error.message}`,
          error.stack,
        );
      } else {
        this.logger.error(`Unknown error occurred: ${error}`);
      }
    }

    // 스키마 정보를 가져오기 위한 쿼리
    const schemaQuery = `
            SELECT schema_name
            FROM information_schema.schemata
            ORDER BY schema_name;
        `;
    try {
      type SchemaRow = { schema_name: string };
      const schemas = (await this.frameRepository.query(
        schemaQuery,
      )) as SchemaRow[];
      this.logger.info('Available Schemas:');
      this.logToFile('Available Schemas:', this.envConfigService.matchedLog);
      schemas.forEach((schema) => {
        this.logger.info(`- ${schema.schema_name}`);
        this.logToFile(
          `- ${schema.schema_name}`,
          this.envConfigService.matchedLog,
        );
      });
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error('Failed to fetch schema information:', error.message);
      }
    }
  }

  logToFile(
    message: string,
    fileName: string,
    level: 'log' | 'warn' | 'error' = 'log',
  ) {
    const logmsg = `${new Date().toISOString()} - ${message}`;
    const fullPath = path.join(this.envConfigService.logPath, fileName);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (process.env.NODE_ENV !== 'production') {
      switch (level) {
        case 'log':
          this.logger.info(message);
          break;
        case 'warn':
          this.logger.warn(message);
          break;
        case 'error':
          this.logger.error(message);
          break;
      }
    }
    fs.appendFileSync(fullPath, logmsg + '\n');
  }

  processStartTime(funcName: string): number {
    const processStartMessage = `Start ${funcName}`;
    this.logger.info(processStartMessage);
    return Date.now(); // 시작 시간을 반환
  }

  processEndTime(funcName: string, startTime: number): void {
    const processEndMessage = `End ${funcName}`;
    this.logger.info(processEndMessage);
    const durationMessage = `${funcName} took ${this.formatSeconds((Date.now() - startTime) / 1000)}(${Date.now() - startTime}ms)`;
    this.logger.info(durationMessage);
  }

  startTimer(
    funcName: string,
    tag: 'IMPORT' | 'SPLIT' | 'INSERT' | 'MATCHING',
  ): {
    end: () => void;
  } {
    const startTime = Date.now();
    const prefix = `[${tag}]`;

    this.logger.info(`${prefix} Start ${funcName}`);

    return {
      end: () => {
        const endTime = Date.now();
        const duration = endTime - startTime;
        this.logger.info(`${prefix} End ${funcName}`);
        this.logger.info(`${prefix} ${funcName} took ${duration}ms`);
      },
    };
  }

  getOutputFolder(): string {
    if (!this.envConfigService.dataPath) {
      throw new Error('DATA_PATH is not defined in environment variables.');
    }
    const today = new Date();
    const formatted = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(
      today.getDate(),
    ).padStart(2, '0')}`;
    return path.join(this.envConfigService.dataPath, `${formatted}_OSM`);
  }

  formatSeconds(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}m ${s}s`;
  }

  getLogFolder(targetCountry: string): string {
    const basePath = this.envConfigService.dataPath;
    if (!basePath) {
      throw new Error('DATA_PATH is not defined in the environment variables.');
    }
    return path.join(this.getOutputFolder(), 'log', targetCountry);
  }

  // 로그 파일에 메시지 기록하는 함수 수정
  splitLogToFile(message: string, fileName: string, targetCountry: string) {
    const logFolderPath = this.getLogFolder(targetCountry);
    const filePath = path.join(logFolderPath, fileName);

    try {
      if (!fs.existsSync(logFolderPath)) {
        fs.mkdirSync(logFolderPath, { recursive: true });
      }
      const logmsg = `${new Date().toISOString()} - ${message}`;
      fs.appendFileSync(filePath, logmsg + '\n', 'utf-8');
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const logErrorMsg = `Failed to write log to file: ${errorMessage}`;
      this.logger.error(logErrorMsg);
      this.logToFile(logErrorMsg, this.envConfigService.splitError);
    }
  }
}
