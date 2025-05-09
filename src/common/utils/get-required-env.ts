import { ConfigService } from '@nestjs/config';

/** 필수 환경변수를 가져오되, 없으면 에러 발생 */
export function getRequiredEnvStr(config: ConfigService, key: string): string {
  const value = config.get<string>(key);
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

export function getRequiredEnvInt(config: ConfigService, key: string): number {
  const value = config.get<number>(key);
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}
