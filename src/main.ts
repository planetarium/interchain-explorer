import { NestFactory } from '@nestjs/core';
import { ApiModule } from './api/api.module';
import { join } from "path";
import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
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
  await app.listen(3000);
}
bootstrap();
