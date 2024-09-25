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