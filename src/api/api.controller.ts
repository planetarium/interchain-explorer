import { Controller, Get, Query, HttpException, HttpStatus, Param, Res } from "@nestjs/common";
import { ApiService } from "./api.service";
import { Response } from 'express';
import { CCTPapiError, LayerZeroError, SquidapiError } from "src/errors";


@Controller('/api')
export class ApiController {
  constructor(private readonly apiService: ApiService) {
  }
  @Get('/list')
  async getRecipientActivities(@Query('txHash') txHash: string) {
    try {
      const layerZeroData = await this.apiService.getLayerZeroScanInfo(txHash);
      const [methodName, recipientActivities] = await Promise.all([
        this.apiService.selectSrcTxAndGetMethodName(
          layerZeroData.source.tx.txHash,
          layerZeroData.pathway.sender.chain
        ),
        (async () => {
          const methodName = await this.apiService.selectSrcTxAndGetMethodName(
            layerZeroData.source.tx.txHash,
            layerZeroData.pathway.sender.chain
          );
          return this.apiService.getRecipientActivities(
            methodName,
            txHash,
            layerZeroData
          );
        })(),
      ]);

      return recipientActivities;
    } catch (error) {
      if (error instanceof LayerZeroError) {
        console.error("LayerZero 에러 발생. CCTP api로 전환:", error.message);
        try {
          const result = await this.getRecipientActivitiesFromCCTP(txHash);
          return result;
        } catch (cctpError) {
          if (cctpError instanceof CCTPapiError) {
            console.error("CCTP api 처리 실패. Squid api로 전환:", cctpError.message);
            try {
              const result = await this.apiService.fetchTransactionData(txHash);
              return result;
            } catch (squidError) {
              console.error("Squid API 처리 실패. Range 크롤링으로 전환:", squidError.message);
              if (squidError instanceof SquidapiError) {
                const result = await this.apiService.fetchAndParseHtml(txHash);
                return result;
              }
            }
          }
        }
      } else {
        console.error("알 수 없는 에러 발생:", error.message);
        throw error;
      }
    }
  }


  private async getRecipientActivitiesFromCCTP(txHash: string) {
    try {
      const txInfo = await this.apiService.getTransactionInfoFromRange(txHash);

      if (!txInfo || typeof txInfo.from_network === 'undefined') {
        throw new CCTPapiError('Invalid txInfo or missing from_network property');
      }

      return this.apiService.getRecipientTxListFromCCTP(txInfo);
    } catch (error) {
      // CCTPapiError 외의 에러를 SquidapiError로 감쌈
      if (!(error instanceof CCTPapiError)) {
        throw new SquidapiError('CCTP 처리 실패: ' + (error.message || 'Unknown error'));
      }
      throw error;
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

