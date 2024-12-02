import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ApiController } from './api.controller';
import { ApiService } from './api.service';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from "@nestjs/schedule";
import { ServeStaticModule } from "@nestjs/serve-static";
import { join } from 'path';
import { MethodMapperService } from "../common/method-mapper.service";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: false,
      envFilePath:
        process.env.NODE_ENV = '.env.development'
    }),
    ScheduleModule.forRoot(),
    HttpModule,
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '../..','public'), // Serve from the 'public' directory
    }),
  ],
  controllers: [ApiController],
  providers: [ApiService, MethodMapperService],
  exports: [ApiService]
})
export class ApiModule {}
