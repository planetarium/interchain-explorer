import { Controller, Get, Query } from "@nestjs/common";
import { ApiService } from "./api.service";
import { ethers, InfuraProvider, TransactionReceipt } from "ethers";
import { ConfigService } from "@nestjs/config";
import { AxiosError } from "axios";
import { createClient } from '@layerzerolabs/scan-client';
import { catchError, firstValueFrom } from "rxjs";
import { HttpService } from "@nestjs/axios";

@Controller('/api')
export class ApiController {
  private mainnetProvider = new InfuraProvider("mainnet", this.configService.get('INFURA_API_KEY'));
  private bnbProvider = new InfuraProvider('bnb', this.configService.get('INFURA_API_KEY'));
  private arbitrumProvider = new InfuraProvider('arbitrum', this.configService.get('INFURA_API_KEY'));
  private mainnetUrl = `https://mainnet.infura.io/v3/${this.configService.get('INFURA_API_KEY')}`;
  private bnbUrl = `https://bsc-mainnet.infura.io/v3/${this.configService.get('INFURA_API_KEY')}`;
  private arbitrumUrl = `https://arbitrum-mainnet.infura.io/v3/${this.configService.get('INFURA_API_KEY')}`;

  constructor(private readonly apiService: ApiService,
              private readonly configService: ConfigService,
              private readonly httpService: HttpService) {}

  @Get('/bnb')
  async getBNBAccountTx(@Query('srcTxHash') srcTxHash: string) {
    const client = createClient('mainnet');
    const {messages} = await client.getMessagesBySrcTxHash(
      srcTxHash,
    );
    const data = await this.getLayerZeroScanInfo(srcTxHash);
    const destinationHash = data.destination.tx.txHash;
    const destTx = await this.getDestinationTxInBNB(destinationHash);
    const transactionGroups = [];
    if(destTx) {
      const receivers = await this.findReceiverInLogs(destTx.logs);
      for (const receiverAddress of receivers) {
        const transactions = await this.getTransactionsByAddressInBNB(receiverAddress, String(parseInt(String(destTx.blockNumber), 16)));
        transactionGroups.push(transactions);
      }
    }
    else {
      console.log("블록 채굴 미완료");
    }
    const response = [];
    response.push({ "sourceTx": data.pathway.sender, "destinationTx": data.pathway.receiver, "transactionGroups": transactionGroups });
    console.log(response);
    return response;
  }

  private async getLayerZeroScanInfo(srcTxHash: string) {
    const url = `https://scan.layerzero-api.com/v1/messages/tx/${srcTxHash}`;
    const { data } = await firstValueFrom(
      this.httpService.get(url).pipe(
        catchError((error: AxiosError) => {
          console.log("Error fetching transaction history:", error.message);
          throw new Error("An error occurred while fetching transaction history.");
        })
      )
    );
    return data.data[0];
  }

  @Get('/arbitrum')
  async getArbitrumAccountTx(@Query('srcTxHash') srcTxHash: string) {
    const srcTx = await this.getTxInMainnet(srcTxHash);
    const abi = await this.getABIInMainnet(srcTx);
    const decodedInputData = await this.getDecodedInputData(abi, srcTxHash);
    console.log(srcTx);
    const recipientIndex = decodedInputData.fragment.inputs.findIndex(param => param.name === 'recipient');
    if (recipientIndex === -1) {
      throw new Error('recipient(수취 예정자)가 존재하지 않는 Contract');
    }
    const recipientAddress = decodedInputData.args[recipientIndex]; // 알맞은 recipient를 찾아오는 로직
    const transactionGroups = [];
    if(recipientAddress) {
      const transactions = await this.getTransactionsByAddressInArbitrum(recipientAddress);
      transactionGroups.push(transactions);
    }
    const response = [];
    response.push({"sourceTx":{"address": srcTxHash, "chain": "ethereum"}, "destinationTx": {}, "transactionGroups": transactionGroups});
    return response;
  }

  private async getDecodedInputData(abi, srcTxHash: string) {
    const decoder = new ethers.Interface(abi);
    const tx = await this.mainnetProvider.getTransaction(srcTxHash);
    const decodedInputData = decoder.parseTransaction({ data: tx.data, value: tx.value });
    return decodedInputData;
  }

  private async getABIInMainnet(srcTx) {
    const url = `https://api.etherscan.io/api?module=contract&action=getabi&address=${srcTx.to}&apikey=${this.configService.get("MAINNET_API_KEY")}`;
    const { data } = await firstValueFrom(
      this.httpService.get(url).pipe(
        catchError((error: AxiosError) => {
          console.log("Error fetching transaction history:", error.message);
          throw new Error("An error occurred while fetching transaction history.");
        })
      )
    );
    const abi = JSON.parse(data.result);
    return abi;
  }

  private async getTxInMainnet(txHash: string) {
    const requestBody = {
      jsonrpc: "2.0",
      method: "eth_getTransactionByHash",
      params: [`${txHash}`],
      id: 1
    };
    const { data } = await firstValueFrom(
      this.httpService.post(this.mainnetUrl, requestBody).pipe(
        catchError((error: AxiosError) => {
          console.log("Error fetching transaction history:", error.message);
          throw new Error("An error occurred while fetching transaction history.");
        })
      )
    );
    return data.result;
  }

  private async getDestinationTxInBNB(txHash: string) : Promise<null | TransactionReceipt>{
    const requestBody = {
      jsonrpc: "2.0",
      method: "eth_getTransactionReceipt",
      params: [`${txHash}`],
      id: 1
    };
    const { data } = await firstValueFrom(
      this.httpService.post(this.bnbUrl, requestBody).pipe(
        catchError((error: AxiosError) => {
          console.log("Error fetching transaction history:", error.message);
          throw new Error("An error occurred while fetching transaction history.");
        })
      )
    );
    return data.result;
  }

  private async findReceiverInLogs(logs) {
    const transferCode = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

    const receivers = logs
      .filter(log => log.topics[0] === transferCode)  // topic[0]이 일치하는 로그만 필터링
      .map(log => log.topics[2]);  // 각 필터된 로그에서 receiver를 추출하자!

    console.log(receivers);  // results는 조건을 만족하는 모든 topic[2] 값의 배열
    return receivers;
  }

  private async getTransactionsByAddressInBNB(address: string, blockNumber: string) {
    address = address.replace(/^0x0+/, "0x");
    const url = `https://api.bscscan.com/api?module=account&action=tokentx&address=${address}&page=1&offset=6&sort=asc&startblock=${blockNumber}&endblock=99999999&apikey=${this.configService.get("BNBSCAN_API_KEY")}`;
    const { data } = await firstValueFrom(
      this.httpService.get(url).pipe(
        catchError((error: AxiosError) => {
          console.log("Error fetching transaction history:", error.message);
          throw new Error("An error occurred while fetching transaction history.");
        })
      )
    );
    for (const tx of data.result)
      tx.chain = "BNB"; //구분을 위한 체인명 삽입

    if (data.message == "OK") {
      return data.result;
    }
  }

  private async getTransactionsByAddressInArbitrum(address: string) {
    const url = `https://api.arbiscan.io/api?module=account&action=txlist&address=${address}&page=1&offset=6&sort=desc&startblock=0&endblock=latest&apikey=${this.configService.get("ARBITRUM_API_KEY")}`;
    const { data } = await firstValueFrom(
      this.httpService.get(url).pipe(
        catchError((error: AxiosError) => {
          console.log("Error fetching transaction history:", error.message);
          throw new Error("An error occurred while fetching account transaction history.");
        })
      )
    );

    for (const tx of data.result)
      tx.chain = "Arbitrum"; //구분을 위한 체인명 삽입
    if(data.message == "OK") {
      return data.result;
    }

    return data.result;
  }

  @Get('/status/mainnet')
  async getStatusMainNet(@Query('txHash') txHash: string) {
    return await this.mainnetProvider.getTransactionReceipt(txHash);
  }

  @Get('/status/bnb')
  async getStatusBNB(@Query('txHash') txHash: string) {
    return null;
    // return await this.bnbProvider.getTransactionReceipt(txHash);
  }
}
