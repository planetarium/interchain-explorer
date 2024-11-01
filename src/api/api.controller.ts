import { Controller, Get, Query, HttpException, HttpStatus } from "@nestjs/common";
import { ApiService } from "./api.service";

@Controller('/api')
export class ApiController {
  constructor(private readonly apiService: ApiService) {}

  @Get('/list') // LayerZero Protocol (OFTP, ProxyOFT, Pancake, Stargate)
  async getRecipientActivities(@Query('txHash') txHash: string) {
    try {
      const layerZeroData = await this.apiService.getLayerZeroScanInfo(txHash);
      const methodName = await this.apiService.selectSrcTxAndGetMethodName(layerZeroData.source.tx.txHash, layerZeroData.pathway.sender.chain);
      return this.apiService.getRecipientActivities(methodName, txHash, layerZeroData);
    } catch (error) {
      // 에러 메시지를 JSON으로 클라이언트에 반환
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.BAD_REQUEST
      );
    }
  }
}
