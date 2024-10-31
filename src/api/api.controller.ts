import { Controller, Get, Query } from "@nestjs/common";
import { ApiService } from "./api.service";

@Controller('/api')
export class ApiController {
  constructor(private readonly apiService: ApiService) {}

  @Get('/list') // LayerZero Protocol (OFTP, ProxyOFT, Pancake, Stargate)
  async getRecipientActivities(@Query('srcTxHash') srcTxHash: string) {
    const methodName = await this.apiService.selectSrcTxAndGetMethodName(srcTxHash);
    return this.apiService.getRecipientActivities(methodName, srcTxHash);
  }
}
