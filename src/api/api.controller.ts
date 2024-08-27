import { Controller, Get, Query } from "@nestjs/common";
import { ApiService } from "./api.service";
import { EtherscanProvider } from "ethers";
import { ConfigService } from "@nestjs/config";


@Controller('/api')
export class ApiController {
  private sepoliaProvider = new EtherscanProvider('sepolia', this.configService.get('SEPOLIA_API_KEY'));
  private bnbProvider = new EtherscanProvider('bnbt', this.configService.get('BNBSCAN_API_KEY'));
  constructor(private readonly apiService: ApiService,
              private readonly configService: ConfigService) {}

  @Get('/status/sepolia')
  async getStatusSepolia(@Query('txHash') txHash: string) {
    return await this.sepoliaProvider.getTransactionReceipt(txHash);
  }

  @Get('/status/bnb')
  async getStatusBNB(@Query('txHash') txHash: string) {
    return await this.bnbProvider.getTransactionReceipt(txHash);
  }
}
