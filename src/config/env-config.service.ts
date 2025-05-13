import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  getRequiredEnvStr,
  getRequiredEnvInt,
} from 'src/common/utils/get-required-env';

@Injectable()
export class EnvConfigService {
  // public readonly processTime: string;

  public readonly schema: string;
  public readonly dataPath: string;
  public readonly logPath: string;

  public readonly dbType: string;
  public readonly dbHost: string;
  public readonly dbPort: string;
  public readonly dbUsername: string;
  public readonly dbDatabase: string;

  public readonly overpassUrl: string;
  public readonly importLogPath: string;
  public readonly dataImport: string;
  public readonly importTimer: string;
  public readonly nodeSearchExpansion: number;

  public readonly splitLogPath: string;
  public readonly linkSplit: string;
  public readonly splitError: string;
  public readonly splitProgress: string;
  public readonly splitTimer: string;

  public readonly insertLogPath: string;
  public readonly insertIdLog: string;
  public readonly insertDataLog: string;

  public readonly mapMatchingLogPath: string;
  public readonly unmatchedLog: string;
  public readonly matchedLog: string;
  public readonly resultLog: string;
  public readonly gpsThreshold: number;
  public readonly matchingProcess: string;

  constructor(private config: ConfigService) {
    this.dbType = getRequiredEnvStr(this.config, 'DB_TYPE');
    this.dbHost = getRequiredEnvStr(this.config, 'DB_HOST');
    this.dbPort = getRequiredEnvStr(this.config, 'DB_PORT');
    this.dbUsername = getRequiredEnvStr(this.config, 'DB_USERNAME');
    this.dbDatabase = getRequiredEnvStr(this.config, 'DB_DATABASE');

    this.dataPath = getRequiredEnvStr(this.config, 'DATA_PATH');
    this.schema = getRequiredEnvStr(this.config, 'DATABASE_SCHEMA');
    this.logPath = getRequiredEnvStr(this.config, 'LOG_PATH');

    //Import-OSM-Data
    this.overpassUrl = getRequiredEnvStr(this.config, 'OVERPASS_URL');
    this.importLogPath = getRequiredEnvStr(this.config, 'IMPORT_LOG_PATH');
    this.dataImport = getRequiredEnvStr(this.config, 'DATA_IMPORT');
    this.importTimer = getRequiredEnvStr(this.config, 'IMPORT_PROCESS_TIME');
    this.nodeSearchExpansion = getRequiredEnvInt(
      this.config,
      'NODE_SEARCH_EXPANSION',
    );

    //Split-OSM-Data
    this.splitLogPath = getRequiredEnvStr(this.config, 'SPLIT_LOG_PATH');
    this.linkSplit = getRequiredEnvStr(this.config, 'LINK_SPLIT');
    this.splitError = getRequiredEnvStr(this.config, 'SPLIT_ERROR');
    this.splitProgress = getRequiredEnvStr(this.config, 'SPLIT_PROGRESS');
    this.splitTimer = getRequiredEnvStr(this.config, 'SPLIT_PROCESS_TIME');

    //Insert-OSM-Data
    this.insertLogPath = getRequiredEnvStr(this.config, 'INSERT_LOG_PATH');
    this.insertIdLog = getRequiredEnvStr(this.config, 'INSERT_ID_LOG');
    this.insertDataLog = getRequiredEnvStr(this.config, 'INSERT_DATA_LOG');

    //Map-Matching
    this.mapMatchingLogPath = getRequiredEnvStr(
      this.config,
      'MAP_MATCHING_LOG_PATH',
    );
    this.resultLog = getRequiredEnvStr(this.config, 'RESULT_LOG');
    this.matchedLog = getRequiredEnvStr(this.config, 'MATCHED_LOG');
    this.unmatchedLog = getRequiredEnvStr(this.config, 'UNMATCHED_LOG');
    this.matchingProcess = getRequiredEnvStr(this.config, 'MATCHING_PROCESS');
    this.gpsThreshold = getRequiredEnvInt(
      this.config,
      'GPS_DISTANCE_THRESHOLD',
    );
  }
}
