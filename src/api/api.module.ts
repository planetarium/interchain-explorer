import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ApiController } from './api.controller';
import { ApiService } from './api.service';
import { DatabaseService } from "./api.db.service.js";
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from "@nestjs/schedule";
import { ServeStaticModule } from "@nestjs/serve-static";
import { join } from 'path';
import { MethodMapperService } from "../common/method-mapper.service";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: false
    }),
    ScheduleModule.forRoot(),
    HttpModule,
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '../..','public'), // Serve from the 'public' directory
    }),
  ],
  controllers: [ApiController],
  providers: [ApiService, MethodMapperService, DatabaseService],
  exports: [ApiService,DatabaseService]
})
export class ApiModule {}
