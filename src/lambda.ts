import { NestFactory } from '@nestjs/core';
import serverlessExpress from '@vendia/serverless-express';
import { Callback, Context, Handler } from 'aws-lambda';

import { ApiModule } from './api/api.module';
import { NestExpressApplication } from "@nestjs/platform-express";
import { join } from "path";

let server: Handler;

async function bootstrap(): Promise<Handler> {
  const app = await NestFactory.create<NestExpressApplication>(ApiModule);
  app.useStaticAssets(join(__dirname, '..', 'public'));
  app.enableCors({
    origin: true,//여기에 url을 넣어도된다.
    credentials: true,
    maxAge: 86400,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-HTTP-Method-Override',
      'X-Forwarded-Proto',
      'X-Forwarded-For',
      'X-Forwarded-Port'
    ],
    optionsSuccessStatus: 204
  });
  await app.init();

  const expressApp = app.getHttpAdapter().getInstance();
  return serverlessExpress({ app: expressApp });
}

export const handler: Handler = async (
  event: any,
  context: Context,
  callback: Callback,
) => {
  server = server ?? (await bootstrap());
  return server(event, context, callback);
};