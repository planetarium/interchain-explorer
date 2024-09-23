import { Controller, Get, Query } from "@nestjs/common";
import { ApiService } from "./api.service";
import { Contract, ethers, EtherscanProvider, InfuraProvider, Provider, TransactionReceipt } from "ethers";
import { ConfigService } from "@nestjs/config";
import { AxiosError } from "axios";
import { catchError, firstValueFrom, timestamp } from "rxjs";
import { HttpService } from "@nestjs/axios";

@Controller('/api')
export class ApiController {
  constructor(private readonly apiService: ApiService,
              private readonly configService: ConfigService,
              private readonly httpService: HttpService) {}

  @Get('/oft') // LayerZero Protocol (OFTP, ProxyOFT, Pancake, Stargate)
  async getOFTAccountTx(@Query('srcTxHash') srcTxHash: string, @Query('chain') chain: string) {
    return await this.apiService.getRecipientTxListFromOFT(srcTxHash, chain);
  }


  @Get('/bridge') // LayerZero Protocol (OFTP, ProxyOFT, Pancake, Stargate)
  async getBridgeAccountTx(@Query('srcTxHash') srcTxHash: string, @Query('chain') chain: string) {
    return await this.apiService.getRecipientTxListFromBridge(srcTxHash, chain);
  }


  @Get('/claim') // LayerZero Protocol (Claim)
  async getClaimAccountTx(@Query('srcTxHash') srcTxHash: string, @Query('chain') chain: string) {
    return await this.apiService.getRecipientTxListFromClaim(srcTxHash, chain);
  }

  @Get('/layerzero') // LayerZero Protocol (Claim)
  async getLayerZeroAccountTx(@Query('srcTxHash') srcTxHash: string, @Query('chain') chain: string) {
    return await this.apiService.getRecipientTxListFromLayerZero(srcTxHash, chain);
  }

  @Get('/drive') // LayerZero Protocol (Drive Bus)
  async getDriveBusAccountTx(@Query('srcTxHash') srcTxHash: string, @Query('chain') chain: string) {
    return await this.apiService.getRecipientTxListFromDrive(srcTxHash, chain);
  }

  @Get('/lifi') // LayerZero Protocol (Li-Fi)
  async getLifiAccountTx(@Query('srcTxHash') srcTxHash: string, @Query('chain') chain: string) {
    return await this.apiService.getRecipientTxListFromLifi(srcTxHash, chain);
  }

  @Get('/rango') // LayerZero Protocol (Li-Fi)
  async getRangoAccountTx(@Query('srcTxHash') srcTxHash: string, @Query('chain') chain: string) {
    return this.apiService.getRecipientTxListFromRango(srcTxHash, chain);
  }

  @Get('/across') // Across Protocol
  async getArbitrumAccountTx(@Query('srcTxHash') srcTxHash: string, @Query('chain') chain: string) {
    return this.apiService.getRecipientTxListFromAcross(srcTxHash, chain);
  }
}
