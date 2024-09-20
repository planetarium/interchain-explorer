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
  async getBNBAccountTx(@Query('srcTxHash') srcTxHash: string, @Query('chain') chain: string) {
    let destinationProvider: Provider
    if(chain === "BNB")
      destinationProvider = this.bnbProvider;
    else if(chain === "Arbitrum")
      destinationProvider = this.arbitrumProvider;


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
    if(sourceTokenSymbol === 'USDT')
      inputAmount *= BigInt(1000000000000); //표기 양식이 다름
    const sourceTx = {"address": depositorAddress, "id": sourceTokenSymbol, "name":sourceTokenName, "chain": "Mainnet", "value": inputAmount.toString()};
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

    const destTx = await destinationProvider.getTransactionReceipt(layerData.destination.tx.txHash);
    const destinationLogs = await this.getTransferLogsInDestination(recipientAddress, destTx.logs);
    const { tokenName: destinationTokenName, tokenSymbol: destinationTokenSymbol } = await this.getTokenInfo(destinationLogs.address, destinationProvider);
    const outputAmount = BigInt(parseInt(destinationLogs.data,16));
    const destinationTx = {"address":recipientAddress, "id": destinationTokenSymbol, "name":destinationTokenName, "chain": chain, "value": outputAmount.toString()};
    const transactionGroups = [];

    let transactions;
    if(chain == 'BNB')
      transactions = await this.getTokenTxByAddressInBNB(recipientAddress, String(destTx.blockNumber));
    else
      transactions = await this.getTokenTxByAddressInArbitrum(recipientAddress, String(destTx.blockNumber));


    if(transactions)
      transactionGroups.push(transactions);
    const response = [];
    response.push({ "sourceTx": sourceTx, "destinationTx": destinationTx, "transactionGroups": transactionGroups });
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

  @Get('/drive') // LayerZero Protocol (Drive Bus)
  async getDriveBusAccountTx(@Query('srcTxHash') srcTxHash: string, @Query('chain') chain: string) {
    let destinationProvider: Provider
    if(chain === "BNB")
      destinationProvider = this.bnbProvider;
    else if(chain === "Arbitrum")
      destinationProvider = this.arbitrumProvider;

    const layerData = await this.getLayerZeroScanInfo(srcTxHash);

    const depositorAddress = layerData.source.tx.from;
    const sourceTx = {"address": depositorAddress, "id": "X", "name": "X", "chain": "Mainnet", "value": "0"};
    const destTx = await destinationProvider.getTransactionReceipt(layerData.destination.tx.txHash);
    const destinationLogs = await this.getTransferLogsInDestination("", destTx.logs);
    let destinationTx, recipientAddress;
    if(destinationLogs) { // Transfer로그 있고 토큰 전송
      recipientAddress = '0x' + destinationLogs.topics[2].slice(-40);
      const { tokenName: destinationTokenName, tokenSymbol: destinationTokenSymbol } = await this.getTokenInfo(destinationLogs.address, destinationProvider);
      const outputAmount = BigInt(parseInt(destinationLogs.data,16));
      destinationTx = {"address": recipientAddress, "id": destinationTokenSymbol, "name":destinationTokenName, "chain": chain, "value": outputAmount.toString()};
    }
    else { // (Transfer이 없이 ETH전송)
      const oftLogs = await this.getOFTReceivedLogsInDestination(destTx.logs);
      recipientAddress = '0x' + oftLogs.topics[2].slice(-40);
      const outputAmountHex = '0x' + oftLogs.data.slice(66);  // Second 32 bytes
      const outputAmount = BigInt(parseInt(outputAmountHex,16));  // Convert to string for large numbers
      destinationTx = {"address": recipientAddress, "id": 'ETH', "name": 'ETH', "chain": chain, "value": outputAmount.toString()};
    }

    const transactionGroups = [];
    let transactions;
    if(chain === 'BNB')
      transactions = await this.getTokenTxByAddressInBNB(recipientAddress, String(destTx.blockNumber));
    else if(chain === "Arbitrum")
      transactions = await this.getTokenTxByAddressInArbitrum(recipientAddress, String(destTx.blockNumber));
    if(transactions)
      transactionGroups.push(transactions);
    const response = [];
    response.push({ "sourceTx": sourceTx, "destinationTx": destinationTx, "transactionGroups": transactionGroups });

    console.log(response);
    return response;
  }

  @Get('/lifi') // LayerZero Protocol (Li-Fi)
  async getLifiAccountTx(@Query('srcTxHash') srcTxHash: string, @Query('chain') chain: string) {
    let sourceProvider: Provider
    let destinationProvider: Provider
    if(chain === "BNB") {
      sourceProvider = this.mainnetProvider;  //source Mainnet이라고 가정
      destinationProvider = this.bnbProvider;
    }
    else if(chain === "Arbitrum") {
      sourceProvider = this.mainnetProvider;
      destinationProvider = this.arbitrumProvider;
    }

    const layerData = await this.getLayerZeroScanInfo(srcTxHash);
    const srcTx = await this.getTxInMainnet(srcTxHash);

    const depositorAddress = layerData.source.tx.from;
    const sourceLogs = await this.getTransferLogsInSource(depositorAddress, srcTx.logs);
    const inputAmount = BigInt(parseInt(sourceLogs.data,16));
    const { tokenName: sourceTokenName, tokenSymbol: sourceTokenSymbol } = await this.getTokenInfo(sourceLogs.address, sourceProvider);
    const sourceTx = {"address": depositorAddress, "id": sourceTokenSymbol, "name": sourceTokenName, "chain": "Mainnet", "value": inputAmount.toString()};

    const destTx = await destinationProvider.getTransactionReceipt(layerData.destination.tx.txHash);

    const LifiLogs = await this.getLiFiLogsInDestination(destTx.logs);
    const decodedLogData = await this.getDecodedLogsForLifi(LifiLogs)
    const recipientIdx = decodedLogData.fragment.inputs.findIndex(param => param.name === 'to');
    const recipientAddress = "0x" + decodedLogData.args[recipientIdx].slice(-40);
    const destinationLogs = await this.getTransferLogsInDestination(recipientAddress, destTx.logs);
    const { tokenName: destinationTokenName, tokenSymbol: destinationTokenSymbol } = await this.getTokenInfo(destinationLogs.address, destinationProvider);
    const outputAmount = BigInt(parseInt(destinationLogs.data,16));
    const destinationTx = {"address": recipientAddress, "id": destinationTokenSymbol, "name":destinationTokenName, "chain": chain, "value": outputAmount.toString()};

    const transactionGroups = [];
    let transactions;
    if(chain === 'BNB')
      transactions = await this.getTokenTxByAddressInBNB(recipientAddress, String(destTx.blockNumber));
    else if(chain === "Arbitrum")
      transactions = await this.getTokenTxByAddressInArbitrum(recipientAddress, String(destTx.blockNumber));
    if(transactions)
      transactionGroups.push(transactions);
    const response = [];
    response.push({ "sourceTx": sourceTx, "destinationTx": destinationTx, "transactionGroups": transactionGroups });

    console.log(response);
    return response;
  }

  @Get('/rango') // LayerZero Protocol (Li-Fi)
  async getRangoAccountTx(@Query('srcTxHash') srcTxHash: string, @Query('chain') chain: string) {
    let sourceProvider: Provider
    let destinationProvider: Provider
    if(chain === "BNB") {
      sourceProvider = this.mainnetProvider;  //source Mainnet이라고 가정
      destinationProvider = this.bnbProvider;
    }
    else if(chain === "Arbitrum") {
      sourceProvider = this.mainnetProvider;
      destinationProvider = this.arbitrumProvider;
    }

    const layerData = await this.getLayerZeroScanInfo(srcTxHash);
    const srcTx = await this.getTxInMainnet(srcTxHash);

    const depositorAddress = layerData.source.tx.from;
    const sourceLogs = await this.getTransferLogsInSource(depositorAddress, srcTx.logs);
    const inputAmount = BigInt(parseInt(sourceLogs.data,16));
    const { tokenName: sourceTokenName, tokenSymbol: sourceTokenSymbol } = await this.getTokenInfo(sourceLogs.address, sourceProvider);
    const sourceTx = {"address": depositorAddress, "id": sourceTokenSymbol, "name": sourceTokenName, "chain": "Mainnet", "value": inputAmount.toString()};
    const destTx = await destinationProvider.getTransactionReceipt(layerData.destination.tx.txHash);

    const rangoLogs = await this.getRangoLogsInDestination(destTx.logs);
    const decodedSendTokenData = await this.getDecodedSendTokenEventForRango(rangoLogs)
    const recipientIdx = decodedSendTokenData.fragment.inputs.findIndex(param => param.name === '_receiver');
    const recipientAddress = decodedSendTokenData.args[recipientIdx];
    const outputAmountIdx = decodedSendTokenData.fragment.inputs.findIndex(param => param.name === '_amount');
    const outputAmount = BigInt(decodedSendTokenData.args[outputAmountIdx]);
    const withdrawalLogs = await this.getWithdrawalLogsInDestination(destTx.logs);
    const { tokenName: destinationTokenName, tokenSymbol: destinationTokenSymbol } = await this.getTokenInfo(withdrawalLogs.address, destinationProvider);
    const destinationTx = {"address": recipientAddress, "id": destinationTokenSymbol, "name":destinationTokenName, "chain": chain, "value": outputAmount.toString()};

    const transactionGroups = [];
    let transactions;
    if(chain === 'BNB')
      transactions = await this.getTokenTxByAddressInBNB(recipientAddress, String(destTx.blockNumber));
    else if(chain === "Arbitrum")
      transactions = await this.getTokenTxByAddressInArbitrum(recipientAddress, String(destTx.blockNumber));
    if(transactions)
      transactionGroups.push(transactions);
    const response = [];
    response.push({ "sourceTx": sourceTx, "destinationTx": destinationTx, "transactionGroups": transactionGroups });

    console.log(response);
    console.log(response[0]['transactionGroups']);
    return response;
  }

  @Get('/arbitrum') // Across Protocol
  async getArbitrumAccountTx(@Query('srcTxHash') srcTxHash: string) {
    const srcTx = await this.getTxInMainnet(srcTxHash);

    const log = srcTx.logs.find(log => log.address === '0x5c7bcd6e7de5423a257d81b442095a1a6ced35c5'); // Across Protocol
    const decodedLogData = await this.getDecodedLogsForAcrossProtocol(log);
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
      const transactions = await this.getTokenTxByAddressInArbitrum(recipientAddress, blockNumber);
      transactionGroups.push(transactions);
    }
    const response = [];
    const { tokenName, tokenSymbol } = await this.getTokenInfo(tokenAddress, this.mainnetProvider);
    const sourceTx = {"address":depositorAddress, "id": tokenSymbol, "name":tokenName, "chain": "Mainnet", "value": inputAmount.toString()};
    const destinationTx = {"address":recipientAddress, "id": tokenSymbol, "name":tokenName, "chain": "Arbitrum", "value": outputAmount.toString()};

    response.push({"sourceTx":sourceTx, "destinationTx": destinationTx, "transactionGroups": transactionGroups});
    console.log(response);
    return response;
  }

  private async getTokenInfo(tokenAddress: string, provider: Provider) {
    if(tokenAddress === '0x0000000000000000000000000000000000000000')
      return { tokenName: 'unknown', tokenSymbol: 'unknown' };
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

  private async getDecodedLogsForAcrossProtocol(log) {
    const acrossProtocolAbi = [
      "event V3FundsDeposited(address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 indexed destinationChainId, uint32 indexed depositId, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, address indexed depositor, address recipient, address exclusiveRelayer, bytes message)"
    ];
    const decoder = new ethers.Interface(acrossProtocolAbi);
    return decoder.parseLog({ topics: log.topics, data: log.data});
  }

  private async getDecodedLogsForLifi(log) {
    const lifiAbi = [
      "event ComposeSent(address from, address to, bytes32 guid, uint16 index, bytes message)"
    ];
    const decoder = new ethers.Interface(lifiAbi);
    return decoder.parseLog({ topics: log.topics, data: log.data});
  }

  private async getDecodedSendTokenEventForRango(log) {
    const rangoAbi = [
      "event SendToken (address _token, uint256 _amount, address _receiver)"
    ];
    const decoder = new ethers.Interface(rangoAbi);
    return decoder.parseLog({ topics: log.topics, data: log.data});
  }

  private async getDecodedOFTReceivedEventForDrive(log) {
    const driveABI = [
      "event OFTReceived (bytes32 guid, uint32 srcEid, address toAddress, uint256 amountReceivedLD)"
    ];
    const decoder = new ethers.Interface(driveABI);
    return decoder.parseLog({ topics: log.topics, data: '0x' + log.data.slice(-66)});
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

  private async getTransferLogs(logs) {
    const transferCode = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const filteredLog = logs
      .filter(log => log.topics[0] === transferCode);
    return filteredLog[0];
  }

  private async getTransferLogsInSource(address: string, logs) {
    const transferCode = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const filteredLog = logs
      .filter(log => log.topics[0] === transferCode && '0x' + log.topics[1].slice(-40).toLowerCase() === address.toLowerCase());
    return filteredLog[0];
  }

  private async getTransferLogsInDestination(address: string, logs) {
    const transferCode = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    if(address === "")
      return logs.filter(log => log.topics[0] === transferCode)[0]; //수신자 주소 모를경우
    return logs
      .filter(log => log.topics[0] === transferCode && '0x' + log.topics[2].slice(-40).toLowerCase() === address.toLowerCase())[0];
  }

  private async getLiFiLogsInDestination(logs) {
    const transferCode = '0x3d52ff888d033fd3dd1d8057da59e850c91d91a72c41dfa445b247dfedeb6dc1';
    return logs
      .filter(log => log.topics[0] === transferCode)[0];
  }

  private async getRangoLogsInDestination(logs) {
    const transferCode = '0xdf4363408b2d9811d1e5c23efdb5bae0b7a68bd9de2de1cbae18a11be3e67ef5'; //SendToken method
    return logs
      .filter(log => log.topics[0] === transferCode)[0];
  }

  private async getWithdrawalLogsInDestination(logs) {
    const transferCode = '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65'; //SendToken method
    return logs
      .filter(log => log.topics[0] === transferCode)[0];
  }

  private async getOFTReceivedLogsInDestination(logs) {
    const transferCode = '0xefed6d3500546b29533b128a29e3a94d70788727f0507505ac12eaf2e578fd9c'; //SendToken method
    return logs
      .filter(log => log.topics[0] === transferCode)[0];
  }

  private async getTokenTxByAddressInBNB(address: string, blockNumber: string) {
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
      return await this.getTxListByAddressInBNB(address, blockNumber);
    }
  }

  private async getTxListByAddressInBNB(address: string, blockNumber: string) {
    if(address.length > 40)
      address = "0x" + address.slice(-40);
    const url = `https://api.bscscan.com/api?module=account&action=txlist&address=${address}&page=1&offset=6&sort=asc&startblock=${blockNumber}&endblock=99999999&apikey=${this.configService.get("BNBSCAN_API_KEY")}`;
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

  private async getTokenTxByAddressInArbitrum(address: string, blockNumber: string) {
    const url = `https://api.arbiscan.io/api?module=account&action=tokentx&address=${address}&page=1&offset=6&sort=desc&startblock=${blockNumber}&endblock=latest&apikey=${this.configService.get("ARBITRUM_API_KEY")}`;
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
    else {
      return await this.getTxListByAddressInArbitrum(address, blockNumber);
    }

  }

  private async getTxListByAddressInArbitrum(address: string, blockNumber: string) {
    if(address.length > 40)
      address = "0x" + address.slice(-40);
    const url = `https://api.bscscan.com/api?module=account&action=txlist&address=${address}&page=1&offset=6&sort=asc&startblock=${blockNumber}&endblock=99999999&apikey=${this.configService.get("BNBSCAN_API_KEY")}`;
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
}
