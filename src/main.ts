import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SyntaxExceptionFilter } from './common/utils/syntax-exception-filter';
// import { WinstonModule } from 'nest-winston';
// import { winstonLoggerOptions } from './common/logger/winston.config';

async function bootstrap() {
  // const app = await NestFactory.create(AppModule, {
  //   logger: WinstonModule.createLogger(winstonLoggerOptions),
  // });
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  app.enableCors();
  app.useGlobalFilters(new SyntaxExceptionFilter());

  const configService = app.get(ConfigService);
  const port = configService.get<number>('APP_PORT', 3000);

  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`Application is running on port: ${port}`);
}
void bootstrap();
