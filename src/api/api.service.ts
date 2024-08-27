import { Inject, Injectable } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";


@Injectable()
export class ApiService {

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}


}
