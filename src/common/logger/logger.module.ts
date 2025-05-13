// winston.factory.ts
import { WinstonModuleOptions } from 'nest-winston';
import * as winston from 'winston';
import { EnvConfigService } from 'src/config/env-config.service';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

EventEmitter.defaultMaxListeners = 20;

function isStringMessage(
  info: winston.Logform.TransformableInfo,
): info is winston.Logform.TransformableInfo & { message: string } {
  return typeof info.message === 'string';
}

const customNestStyleFormat: winston.Logform.Format = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message }) => {
    return `[GeoLinker] ${String(timestamp)} ${String(level)} ${String(message)}`;
  }),
);

export function winstonLoggerFactory(
  envConfigService: EnvConfigService,
): WinstonModuleOptions {
  const today = new Date();
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const folderPath = path.join(envConfigService.logPath, `${dateStr}_OSM`);

  const importLogDir = path.join(folderPath, 'import');
  const splitLogDir = path.join(folderPath, 'split');
  const insertLogDir = path.join(folderPath, 'insert');
  const matchLogDir = path.join(folderPath, 'mapMatching');

  [importLogDir, splitLogDir, insertLogDir, matchLogDir].forEach((dir) =>
    fs.mkdirSync(dir, { recursive: true }),
  );

  const importTransports: winston.transport[] = [
    new winston.transports.File({
      filename: `${importLogDir}/${envConfigService.dataImport}`,
      level: 'info',
      format: winston.format((info) =>
        isStringMessage(info) && info.message.includes('[IMPORT]')
          ? info
          : false,
      )(),
    }),
    new winston.transports.File({
      filename: `${importLogDir}/${envConfigService.dataImport}`,
      level: 'info',
      format: winston.format((info) =>
        isStringMessage(info) && info.message.includes('[IMPORT TIME]')
          ? info
          : false,
      )(),
    }),
    new winston.transports.File({
      filename: `${importLogDir}/${envConfigService.dataImport}`,
      level: 'warn',
      format: winston.format((info) =>
        isStringMessage(info) && info.message.includes('[IMPORT WARNING]')
          ? info
          : false,
      )(),
    }),
    new winston.transports.File({
      filename: `${importLogDir}/${envConfigService.dataImport}`,
      level: 'error',
      format: winston.format((info) =>
        isStringMessage(info) && info.message.includes('[IMPORT ERROR]')
          ? info
          : false,
      )(),
    }),
  ];

  const splitTransports: winston.transport[] = [
    new winston.transports.File({
      filename: `${splitLogDir}/${envConfigService.linkSplit}`,
      level: 'info',
      format: winston.format((info) =>
        isStringMessage(info) && info.message.includes('[SPLIT]')
          ? info
          : false,
      )(),
    }),
    new winston.transports.File({
      filename: `${splitLogDir}/${envConfigService.linkSplit}`,
      level: 'info',
      format: winston.format((info) =>
        isStringMessage(info) && info.message.includes('[SPLIT TIME]')
          ? info
          : false,
      )(),
    }),
    new winston.transports.File({
      filename: `${splitLogDir}/${envConfigService.linkSplit}`,
      level: 'warn',
      format: winston.format((info) =>
        isStringMessage(info) && info.message.includes('[SPLIT WARNING]')
          ? info
          : false,
      )(),
    }),
    new winston.transports.File({
      filename: `${splitLogDir}/${envConfigService.linkSplit}`,
      level: 'error',
      format: winston.format((info) =>
        isStringMessage(info) && info.message.includes('[SPLIT ERROR]')
          ? info
          : false,
      )(),
    }),
  ];

  const insertTransports: winston.transport[] = [
    new winston.transports.File({
      filename: `${insertLogDir}/${envConfigService.insertDataLog}`,
      level: 'info',
      format: winston.format((info) =>
        isStringMessage(info) && info.message.includes('[INSERT]')
          ? info
          : false,
      )(),
    }),
    new winston.transports.File({
      filename: `${insertLogDir}/${envConfigService.insertDataLog}`,
      level: 'info',
      format: winston.format((info) =>
        isStringMessage(info) && info.message.includes('[INSERT TIME]')
          ? info
          : false,
      )(),
    }),
    new winston.transports.File({
      filename: `${insertLogDir}/${envConfigService.insertDataLog}`,
      level: 'warn',
      format: winston.format((info) =>
        isStringMessage(info) && info.message.includes('[INSERT WARNING]')
          ? info
          : false,
      )(),
    }),
    new winston.transports.File({
      filename: `${insertLogDir}/${envConfigService.insertDataLog}`,
      level: 'error',
      format: winston.format((info) =>
        isStringMessage(info) && info.message.includes('[INSERT ERROR]')
          ? info
          : false,
      )(),
    }),
  ];

  const matchingTransports: winston.transport[] = [
    new winston.transports.File({
      filename: `${matchLogDir}/${envConfigService.matchedLog}`,
      level: 'info',
      format: winston.format((info) =>
        isStringMessage(info) && info.message.includes('[MAP-MATCHING]')
          ? info
          : false,
      )(),
    }),
    new winston.transports.File({
      filename: `${matchLogDir}/${envConfigService.matchedLog}`,
      level: 'warn',
      format: winston.format((info) =>
        isStringMessage(info) && info.message.includes('[MATCHING WARNING]')
          ? info
          : false,
      )(),
    }),
    new winston.transports.File({
      filename: `${matchLogDir}/${envConfigService.unmatchedLog}`,
      level: 'warn',
      format: winston.format((info) =>
        isStringMessage(info) && info.message.includes('[UNMATCHED]')
          ? info
          : false,
      )(),
    }),
    new winston.transports.File({
      filename: `${matchLogDir}/${envConfigService.resultLog}`,
      level: 'info',
      format: winston.format((info) =>
        isStringMessage(info) && info.message.includes('[RESULT]')
          ? info
          : false,
      )(),
    }),
  ];

  const consoleTransport = new winston.transports.Console({
    format: customNestStyleFormat,
  });
  return {
    level: 'silly',
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.label({ label: 'GeoLinker' }),
      winston.format.printf((info) => {
        const { timestamp, label, level } = info;
        const message = isStringMessage(info)
          ? info.message
          : JSON.stringify(info.message);
        return `[${String(label)}] ${String(timestamp)} ${String(level)}: ${String(message)}`;
      }),
    ),
    transports: [
      ...importTransports,
      ...splitTransports,
      ...insertTransports,
      ...matchingTransports,
      consoleTransport,
    ],
  };
}
