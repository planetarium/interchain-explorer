import { Controller, Get, Query } from "@nestjs/common";
import { ApiService } from "./api.service";
import { Contract, ethers, EtherscanProvider, InfuraProvider, Provider, TransactionReceipt } from "ethers";
import { ConfigService } from "@nestjs/config";
import { AxiosError } from "axios";
import { createClient } from '@layerzerolabs/scan-client';
import { catchError, firstValueFrom, timestamp } from "rxjs";
import { HttpService } from "@nestjs/axios";

@Controller('/api')
export class ApiController {
  private mainnetProvider = new InfuraProvider("mainnet", this.configService.get('INFURA_API_KEY'));
  // private bnbProvider = new InfuraProvider('bnb', this.configService.get('INFURA_API_KEY'));
  private bnbProvider = new EtherscanProvider('bnb', this.configService.get('BNBSCAN_API_KEY'));
  private arbitrumProvider = new InfuraProvider('arbitrum', this.configService.get('INFURA_API_KEY'));
  private mainnetUrl = `https://mainnet.infura.io/v3/${this.configService.get('INFURA_API_KEY')}`;
  private bnbUrl = `https://bsc-mainnet.infura.io/v3/${this.configService.get('INFURA_API_KEY')}`;
  private arbitrumUrl = `https://arbitrum-mainnet.infura.io/v3/${this.configService.get('INFURA_API_KEY')}`;

  constructor(private readonly apiService: ApiService,
              private readonly configService: ConfigService,
              private readonly httpService: HttpService) {}

  @Get('/bnb') // LayerZero Protocol (OFTP
  async getBNBAccountTx(@Query('srcTxHash') srcTxHash: string) {
    const layerData = await this.getLayerZeroScanInfo(srcTxHash);
    const srcTx = await this.getTxInMainnet(srcTxHash);
    const depositorAddress = layerData.source.tx.from;
    const abi = await this.getTxABIInMainnet(srcTx);

    const decodedInputData = await this.getDecodedInputData(abi, srcTxHash);
    /** ProxyOFT일경우 logs -> params 조회**/
    let inputAmountIdx = decodedInputData.fragment.inputs.findIndex(param => param.name === "_amount");
    let inputAmount;
    if(inputAmountIdx == -1) { /** OFT일경우 logs -> components 조회**/
      const OFTData = decodedInputData.fragment.inputs.find(param => param.name === '_sendParam');
      inputAmountIdx = OFTData.components.findIndex(param => param.name === 'amountLD');
      if(inputAmountIdx == -1) { /** OKX Proxy일경우 logs -> components 조회**/
        const ProxyData = decodedInputData.fragment.inputs.find(param => param.name === '_request');
        inputAmountIdx = ProxyData.components.findIndex(param => param.name === 'amount');
      }
      inputAmount = BigInt(decodedInputData.args.at(0)[inputAmountIdx]);
    }
    else {
      inputAmount = BigInt(decodedInputData.args[inputAmountIdx]);
    }

    const sourceLogs = await this.getTransferLogsInSource(depositorAddress, srcTx.logs);
    const { tokenName: sourceTokenName, tokenSymbol: sourceTokenSymbol } = await this.getTokenInfo(sourceLogs.address, this.mainnetProvider);
    const sourceTx = {"address": depositorAddress, "id": sourceTokenSymbol, "name":sourceTokenName, "chain": "Ethereum", "value": inputAmount.toString()};

    let recipientIndex = decodedInputData.fragment.inputs.findIndex(param => param.name === '_toAddress');
    let recipientAddress;
    if(recipientIndex == -1) {
      const OFTData = decodedInputData.fragment.inputs.find(param => param.name === '_sendParam');
      recipientIndex = OFTData.components.findIndex(param => param.name === 'to');
      if(inputAmountIdx == -1) { /** OKX Proxy일경우 logs -> components 조회**/
        const ProxyData = decodedInputData.fragment.inputs.find(param => param.name === '_request');
        recipientIndex = ProxyData.components.findIndex(param => param.name === 'to');
      }
      recipientAddress = "0x" + decodedInputData.args.at(0)[recipientIndex].slice(-40);
    }
    else {
      recipientAddress = "0x" + decodedInputData.args[recipientIndex].slice(-40);
    }

    const destTx = await this.bnbProvider.getTransactionReceipt(layerData.destination.tx.txHash);
    const destinationLogs = await this.getTransferLogsInDestination(recipientAddress, destTx.logs);
    const { tokenName: destinationTokenName, tokenSymbol: destinationTokenSymbol } = await this.getTokenInfo(destinationLogs.address, this.bnbProvider);
    const outputAmount = BigInt(parseInt(destinationLogs.data,16));
    const destinationTx = {"address":recipientAddress, "id": destinationTokenSymbol, "name":destinationTokenName, "chain": "BNB Chain", "value": outputAmount.toString()};
    const transactionGroups = [];
    const transactions = await this.getTransactionsByAddressInBNB(recipientAddress, String(destTx.blockNumber));
    transactionGroups.push(transactions);
    const response = [];
    response.push({ "sourceTx": sourceTx, "destinationTx": destinationTx, "transactionGroups": transactionGroups });
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

  @Get('/arbitrum') // Across Protocol
  async getArbitrumAccountTx(@Query('srcTxHash') srcTxHash: string) {
    const srcTx = await this.getTxInMainnet(srcTxHash);

    const log = srcTx.logs.find(log => log.address === '0x5c7bcd6e7de5423a257d81b442095a1a6ced35c5'); // Across Protocol
    const decodedLogData = await this.getDecodedLogs(log);
    const tokenIdx = decodedLogData.fragment.inputs.findIndex(param => param.name === 'inputToken');
    const inputAmountIdx = decodedLogData.fragment.inputs.findIndex(param => param.name === 'inputAmount');
    const outputAmountIdx = decodedLogData.fragment.inputs.findIndex(param => param.name === 'outputAmount');
    const tokenAddress = String(decodedLogData.args[tokenIdx]);
    const inputAmount = BigInt(decodedLogData.args[inputAmountIdx]);
    const outputAmount = BigInt(decodedLogData.args[outputAmountIdx]);

    const blockData = await this.mainnetProvider.getBlock(srcTx.blockNumber);
    const timeStamp = String(blockData.timestamp);
    const depositorIdx = decodedLogData.fragment.inputs.findIndex(param => param.name === 'depositor');
    const recipientIdx = decodedLogData.fragment.inputs.findIndex(param => param.name === 'recipient');
    if (recipientIdx === -1) {
      throw new Error('recipient(수취 예정자)가 존재하지 않는 Contract');
    }
    const depositorAddress = decodedLogData.args[depositorIdx]; // 알맞은 depositor를 찾아오는 로직
    const recipientAddress = decodedLogData.args[recipientIdx]; // 알맞은 recipient를 찾아오는 로직
    const transactionGroups = [];
    if(recipientAddress) {
      const blockNumber = await this.getBlockNumberByTimeStamp(timeStamp);
      const transactions = await this.getTransactionsByAddressInArbitrum(recipientAddress, blockNumber);
      transactionGroups.push(transactions);
    }
    const response = [];
    const { tokenName, tokenSymbol } = await this.getTokenInfo(tokenAddress, this.mainnetProvider);
    const sourceTx = {"address":depositorAddress, "id": tokenSymbol, "name":tokenName, "chain": "Ethereum", "value": inputAmount.toString()};
    const destinationTx = {"address":recipientAddress, "id": tokenSymbol, "name":tokenName, "chain": "Arbitrum", "value": outputAmount.toString()};

    response.push({"sourceTx":sourceTx, "destinationTx": destinationTx, "transactionGroups": transactionGroups});
    console.log(response);
    return response;
  }

  private async getTokenInfo(tokenAddress: string, provider: Provider) {
    const tokenContract = new Contract(tokenAddress, ["function name() view returns (string)", "function symbol() view returns (string)"], provider);
    const tokenName = await tokenContract.name();
    const tokenSymbol = await tokenContract.symbol();
    return { tokenName, tokenSymbol };
  }

  private async getDecodedInputData(abi, srcTxHash: string) {
    const decoder = new ethers.Interface(abi);
    const tx = await this.mainnetProvider.getTransaction(srcTxHash);
    const decodedInputData = decoder.parseTransaction({ data: tx.data, value: tx.value });
    return decodedInputData;
  }

  private async getDecodedLogs(log) {
    const acrossProtocolAbi = [
      "event V3FundsDeposited(address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 indexed destinationChainId, uint32 indexed depositId, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, address indexed depositor, address recipient, address exclusiveRelayer, bytes message)"
    ];
    const decoder = new ethers.Interface(acrossProtocolAbi);
    return decoder.parseLog({ topics: log.topics, data: log.data});
  }

  private async getTxABIInMainnet(srcTx) {
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

  private async getTxInMainnet(txHash: string): Promise<null | TransactionReceipt>{
    const requestBody = {
      jsonrpc: "2.0",
      method: "eth_getTransactionReceipt",
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


  private async getTxInBNB(txHash: string) : Promise<null | TransactionReceipt>{
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

  private async getTransferLogsInSource(address, logs) {
    const transferCode = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const filteredLog = logs
      .filter(log => log.topics[0] === transferCode && '0x' + log.topics[1].slice(-40) === address);
    return filteredLog[0];
  }

  private async getTransferLogsInDestination(address, logs) {
    const transferCode = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const filteredLog = logs
      .filter(log => log.topics[0] === transferCode && '0x' + log.topics[2].slice(-40) === address);
    return filteredLog[0];
  }

  private async getTransactionsByAddressInBNB(address: string, blockNumber: string) {
    if(address.length > 40)
      address = "0x" + address.slice(-40);
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
    else {
      console.log(data.message);
    }
  }
  private async getBlockNumberByTimeStamp(timeStamp: string) {
    const url = `https://api.arbiscan.io/api?module=block&action=getblocknobytime&timestamp=${timeStamp}&closest=after&apikey=YourApiKeyToken`
    const { data } = await firstValueFrom(
      this.httpService.get(url).pipe(
        catchError((error: AxiosError) => {
          console.log("Error fetching transaction history:", error.message);
          throw new Error("An error occurred while fetching account transaction history.");
        })
      )
    );
    if(data.message == "OK")
      return data.result;

    return "0";
  }
  private async getTransactionsByAddressInArbitrum(address: string, blockNumber: string) {
    const url = `https://api.arbiscan.io/api?module=account&action=txlist&address=${address}&page=1&offset=6&sort=desc&startblock=${blockNumber}&endblock=latest&apikey=${this.configService.get("ARBITRUM_API_KEY")}`;
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

    return "";
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
