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
      // LayerZero 에러 발생 시 CCTP로 이동
      console.error("LayerZero 조회 중 에러 발생. CCTP로 전환:", error.message);
      return this.getRecipientActivitiesFromCCTP(txHash);
    }
  }

  private async getRecipientActivitiesFromCCTP(@Query('txHash') txHash: string) {
    try {
      const txInfo = await this.apiService.getTransactionInfoFromRange(txHash);
      return this.apiService.getRecipientTxListFromCCTP(txInfo);
    } catch (error) {
      // 에러 메시지를 JSON으로 클라이언트에 반환
      throw new HttpException(
        {
          success: false,
          message: error.message,
          error: error.stack // 스택 추적 정보를 추가
        },
        HttpStatus.BAD_REQUEST
      );
    }
  }
}
