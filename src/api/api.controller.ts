import { Controller, Get, Query } from "@nestjs/common";
import { ApiService } from "./api.service";
import { EtherscanProvider } from "ethers";
import { ConfigService } from "@nestjs/config";
import { AxiosError } from "axios";
import { createClient } from '@layerzerolabs/scan-client';
import { catchError, firstValueFrom } from "rxjs";
import { HttpService } from "@nestjs/axios";


@Controller('/api')
export class ApiController {
  private mainnetProvider = new EtherscanProvider('mainnet', this.configService.get('MAINNET_API_KEY'));
  private bnbProvider = new EtherscanProvider('bnb', this.configService.get('BNBSCAN_API_KEY'));
  constructor(private readonly apiService: ApiService,
              private readonly configService: ConfigService,
              private readonly httpService: HttpService) {}

  @Get('')
  async getDestinationTxHash() {
    const client = createClient('mainnet');
    const {messages} = await client.getMessagesBySrcTxHash(
      '0x6940134968dc588150608e93f38eb08825488c1b6cbe8dcffe1e63df7c0fd791',
    );

    const destinationHash = messages.at(0).dstTxHash;
    const destinationTx = await this.bnbProvider.getTransactionReceipt(destinationHash);
    const url = `https://api.bscscan.com/api?module=account&action=txlistinternal&txhash=${destinationTx.hash}&apikey=${this.configService.get('BNBSCAN_API_KEY')}`;
    const { data } = await firstValueFrom(
      this.httpService.get(url).pipe(
        catchError((error: AxiosError) => {
          console.log('Error fetching transaction history:', error.message);
          throw new Error('An error occurred while fetching transaction history.');
        }),
      ),
    );
    if(data.message == 'OK') {
      const receiverAddress = data.result[data.result.length - 1].to;
      console.log(receiverAddress);
    }
  }

  @Get('/status/mainnet')
  async getStatusMainNet(@Query('txHash') txHash: string) {
    return await this.mainnetProvider.getTransactionReceipt(txHash);
  }

  @Get('/status/bnb')
  async getStatusBNB(@Query('txHash') txHash: string) {
    return await this.bnbProvider.getTransactionReceipt(txHash);
  }
}
