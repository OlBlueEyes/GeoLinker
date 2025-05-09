import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

@Catch(SyntaxError)
export class SyntaxExceptionFilter implements ExceptionFilter {
  catch(exception: SyntaxError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception.message.includes('Unexpected token')) {
      response.status(HttpStatus.BAD_REQUEST).json({
        message: ['It is not a JSON format.'],
        error: 'Bad Request',
        statusCode: HttpStatus.BAD_REQUEST,
      });
    } else {
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      });
    }
  }
}
