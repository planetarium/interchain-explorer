import { Controller, Get, Query, HttpException, HttpStatus,Param,Res } from "@nestjs/common";
import { ApiService } from "./api.service";
import { Response } from 'express';
import { CCTPapiError,LayerZeroError } from "src/errors";


@Controller('/api')
export class ApiController {
  constructor(private readonly apiService: ApiService) {
  }

  @Get('/list') // LayerZero Protocol (OFTP, ProxyOFT, Pancake, Stargate)
  async getRecipientActivities(@Query('txHash') txHash: string) {
    try {
      const layerZeroData = await this.apiService.getLayerZeroScanInfo(txHash);
      const methodName = await this.apiService.selectSrcTxAndGetMethodName(layerZeroData.source.tx.txHash, layerZeroData.pathway.sender.chain);
      return this.apiService.getRecipientActivities(methodName, txHash, layerZeroData);
    } catch (error) {
      if (error instanceof LayerZeroError) {
        console.error("LayerZero 에러 발생. CCTP api로 전환:", error.message);
        return this.getRecipientActivitiesFromCCTP(txHash);
      } else if (error instanceof CCTPapiError) {
        console.error("CCTP api 처리 실패. Range crawling 대체 수행:", error.message);
        return this.apiService.fetchAndParseHtml(txHash);
      } else {
        console.error("알 수 없는 에러 발생:", error.message);
        throw error; // 최종적으로 핸들링되지 않은 에러를 클라이언트로 반환
      }
    }}

  private async getRecipientActivitiesFromCCTP(txHash: string) {
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

  @Get(':hash')
  async parseHtml(@Param('hash') hash: string, @Res() res: Response): Promise<any> {
    if (!hash) {
      return res
        .status(HttpStatus.BAD_REQUEST)
        .json({ error: 'Hash parameter is required' });
    }

    try {
      const jsonResult = await this.apiService.fetchAndParseHtml(hash);
      // JSON 유효성 검사
      if (!jsonResult || typeof jsonResult !== 'object') {
        return res
          .status(HttpStatus.UNPROCESSABLE_ENTITY)
          .json({ error: 'Invalid JSON format', details: jsonResult });
      }

      return res.status(HttpStatus.OK).json(jsonResult);
    } catch (error: any) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to parse HTML',
        details: error.message,
      });
    }
  }
}

