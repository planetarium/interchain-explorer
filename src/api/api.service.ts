import { Injectable } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { Contract, ethers, EtherscanProvider, InfuraProvider, Provider, Transaction, TransactionDescription, TransactionReceipt } from "ethers";
import { catchError, firstValueFrom } from "rxjs";
import { AxiosError } from "axios";
import { DatabaseService } from "./api.db.service.js";
import { MethodMapperService } from "../common/method-mapper.service";
import { EventDictionary } from "../common/event.dictionary";
import { ETHEREUM_API_KEY, BNBSCAN_API_KEY, INFURA_API_KEY, ARBITRUM_API_KEY, BASE_API_KEY} from "../constants/environment";
import axios from 'axios';
import * as cheerio from 'cheerio';
import { LayerZeroError, CCTPapiError } from '../errors';
import { USDC_ADDRESSES_MAP } from "../common/usdc-address";

@Injectable()
export class ApiService {
  private mainnetProvider = new InfuraProvider("mainnet", INFURA_API_KEY);
  private bnbProvider = new EtherscanProvider('bnb', BNBSCAN_API_KEY);
  private arbitrumProvider = new InfuraProvider('arbitrum', INFURA_API_KEY);
  private baseProvider = new InfuraProvider('base', INFURA_API_KEY);
  private mainnetUrl = `https://mainnet.infura.io/v3/${INFURA_API_KEY}`;
  private bnbUrl = `https://bsc-mainnet.infura.io/v3/${INFURA_API_KEY}`;
  private arbiUrl = `https://arbitrum-mainnet.infura.io/v3/${INFURA_API_KEY}`;
  private baseUrl = `https://base-mainnet.infura.io/v3/${INFURA_API_KEY}`;

  constructor(
    private readonly httpService: HttpService,
    private readonly methodMapperService: MethodMapperService,
    private readonly databaseService: DatabaseService
  ) {}

  async selectSrcTxAndGetMethodName(srcTxHash: string, sourceChain: string) { // 무슨 메서드를 실행시켰는지 알아내기 (OFT 송금, Claim, Airdrop ...)
    let srcTx = await this.getTx(srcTxHash, sourceChain);
    if(!srcTx)
      throw new Error('불가능한 체인이거나 지원하지 않는 메서드입니다.')
    const methodId = this.getMethodId(srcTx);
    if(methodId === undefined)
      throw new Error(`정의되지 않은 메서드입니다. ${srcTx.input.slice(0,10)}`)
    return this.methodMapperService.getMethodName(methodId);
  }
  async getRecipientActivities(
    methodName: string,
    providedTxHash: string,
    layerZeroData
  ) {
    if (methodName === "Unknown Method") return;
  
    let result;
    switch (methodName) {
      case "Drive Bus":
        result = await this.getRecipientTxListFromDrive(layerZeroData);
        break;
      case "stargateSwapAndBridge":
        result = await this.getRecipientTxListFromRango(layerZeroData);
        break;
      case "swapAndStartBridgeTokensViaStargate":
        result = await this.getRecipientTxListFromLifi(layerZeroData);
        break;
      case "claim":
        result = await this.getRecipientTxListFromClaim(layerZeroData);
        break;
      case "donateAndClaim":
        result = await this.getRecipientTxListFromLayerZero(layerZeroData);
        break;
      case "swapAndBridge":
        result = await this.getRecipientTxListFromBridge(layerZeroData);
        break;
      case "deposit":
        result = await this.getRecipientTxListFromAcross(providedTxHash, "arbitrum");
        break;
      case "send":
      case "sendFrom":
      case "sendOFT":
      case "sendOFTV2":
      case "swapBridgeToV2":
      case "sendProxyOFTV2":
      case "SendProxyOFTFeeV2":
        result = await this.getRecipientTxListFromOFT(layerZeroData);
        break;
      default:
        result = '';
    }
    if (Array.isArray(result)) {
      await this.databaseService.saveTransaction({ contents: result });
      console.log('Saved array to database:', result);
    } else {
      await this.databaseService.saveTransaction({ contents: result });
      console.log('Saved result to database:', result);
    }
  
    return result;
  }

  // async getRecipientActivities(methodName: string, providedTxHash: string, layerZeroData) {
  //   if (methodName === "Unknown Method")
  //     return;
  //   if (methodName === "Drive Bus")
  //     return this.getRecipientTxListFromDrive(layerZeroData);
  //   else if (methodName === "stargateSwapAndBridge")
  //     return this.getRecipientTxListFromRango(layerZeroData);
  //   else if (methodName === "swapAndStartBridgeTokensViaStargate")
  //     return this.getRecipientTxListFromLifi(layerZeroData);
  //   else if (methodName === "claim")
  //     return this.getRecipientTxListFromClaim(layerZeroData);
  //   else if (methodName === "donateAndClaim")
  //     return this.getRecipientTxListFromLayerZero(layerZeroData);
  //   else if (methodName === "swapAndBridge")
  //     return this.getRecipientTxListFromBridge(layerZeroData);
  //   else if (methodName === "deposit")
  //     return this.getRecipientTxListFromAcross(providedTxHash, "arbitrum");
  //   else if (methodName === "send" || "sendFrom" || "sendOFT" || "sendOFTV2" || "swapBridgeToV2" || "sendProxyOFTV2" || "SendProxyOFTFeeV2")
  //     return this.getRecipientTxListFromOFT(layerZeroData);
  //   else
  //     return '';
  // }


  async getRecipientTxListFromOFT(layerData) { //src: 인풋, 로그 / dest: 로그
    const srcChain = layerData.pathway.sender.chain;
    const destChain = layerData.pathway.receiver.chain;
    const sourceProvider = this.selectProvider(srcChain);
    const destinationProvider = this.selectProvider(destChain);
    const srcTx = await this.getTxReceipt(layerData.source.tx.txHash, srcChain);
    const depositorAddress = layerData.source.tx.from;
    const abi = await this.getContractABI(srcTx, srcChain);
    const srcTimeStamp = await this.getTimeStamp(srcTx.blockNumber.toString(), srcChain);
    let { decodedInputData, inputAmountIdx, inputAmount } = await this.parseInputData(abi, layerData.source.tx.txHash, sourceProvider);

    /** 토큰의 종류를 조회하기 위해 로그에서 전송되는 토큰 정보를 가져옵니다. function name() view returns (string)", "function symbol() view returns (string) **/
    const sourceLogs = await this.getTransferLogsInSource(depositorAddress, srcTx.logs);
    let { sourceTokenName, sourceTokenSymbol } = await this.getTokenInfoInTransferLogs(sourceLogs, sourceProvider);
    if (sourceTokenSymbol === "USDT" || sourceTokenSymbol ===  "USDC")
      inputAmount *= BigInt(1000000000000); //표기 양식이 다름

    /** sourceTx 생성!! **/
    const sourceTx = { "address": depositorAddress, "id": sourceTokenSymbol, "name": sourceTokenName, "chain": srcChain, "value": inputAmount.toString(),
      "timestamp": srcTimeStamp, "hash": layerData.source.tx.txHash};
    /** 수취자의 계좌를 조회합니다. **/
    let recipientAddress = this.getRecipientAddressFromOFT(decodedInputData, inputAmountIdx);

    const destTx = await destinationProvider.getTransactionReceipt(layerData.destination.tx.txHash);
    const destTimeStamp = await this.getTimeStamp('0x'+destTx.blockNumber.toString(16), destChain);
    /** 수취자의 계좌주소를 통해 Transfer 로그를 찾아냅니다. (토큰 주소도 포함되어 있음)**/
    const destinationLogs = await this.getTransferLogsInDestination(recipientAddress, destTx.logs);

    let destinationTokenName = "ETH", destinationTokenSymbol = "ETH";

    let outputAmount, destinationTx;
    /** TransferLog가 없는 경우는 단순히 ETH를 송금한 경우 체크. **/
    if (destinationLogs) { //token으로 전송하는 경우.
      const { tokenName, tokenSymbol } = await this.getTokenInfo(sourceLogs.address, sourceProvider);
      destinationTokenName = tokenName;
      destinationTokenSymbol = tokenSymbol;
      outputAmount = BigInt(parseInt(destinationLogs.data, 16));
    } else { //Transfer 로그가 없이 ETH전송
      const oftLogs = await this.getOFTReceivedLogsInDestination(destTx.logs);
      recipientAddress = "0x" + oftLogs.topics[2].slice(-40);
      const outputAmountHex = "0x" + oftLogs.data.slice(66);  // Second 32 bytes
      outputAmount = BigInt(parseInt(outputAmountHex, 16));  // Convert to string for large numbers
    }
    /** destinationTx 생성!! **/
    destinationTx = { "address": recipientAddress, "id": destinationTokenSymbol, "name": destinationTokenName, "chain": destChain, "value": outputAmount.toString(),
      "timestamp": destTimeStamp, "hash": layerData.destination.tx.txHash};
    const { transactionGroups, tokenGroups } = await this.makeResponseGroups(destChain, recipientAddress, destTx.blockNumber);
    const response = this.makeResponse("LayerZero", sourceTx, destinationTx, transactionGroups, tokenGroups);
    console.log(response);
    return response;
  }

  async getRecipientTxListFromBridge(layerData) { //src: 인풋, 로그 / dest: 로그
    const srcChain = layerData.pathway.sender.chain;
    const destChain = layerData.pathway.receiver.chain;
    const sourceProvider = this.selectProvider(layerData.pathway.sender.chain);
    const destinationProvider = this.selectProvider(layerData.pathway.receiver.chain);
    const srcTx = await this.getTxReceipt(layerData.source.tx.txHash);
    const srcTimeStamp = await this.getTimeStamp(srcTx.blockNumber.toString(), layerData.pathway.sender.chain);

    const depositorAddress = layerData.source.tx.from;
    const abi = await this.getContractABI(srcTx, srcChain);

    const decodedInputData = await this.getDecodedInputData(abi, layerData.source.tx.txHash, sourceProvider);
    const BridgeData = decodedInputData.fragment.inputs.find(param => param.name === '_bridgeParams');
    /** InputData 파싱과정 **/
    const inputAmountIdx = BridgeData.components.findIndex(param => param.name === 'amountIn');
    const inputAmount = BigInt(decodedInputData.args.at(0)[inputAmountIdx]);

    const sourceTokenIdx = BridgeData.components.findIndex(param => param.name === 'tokenIn');
    const sourceToken = decodedInputData.args.at(0)[sourceTokenIdx];

    const recipientAddressIdx = BridgeData.components.findIndex(param => param.name === 'to');
    const recipientAddress = "0x" + decodedInputData.args.at(0)[recipientAddressIdx].slice(-40);

    /** TransferLog에서 토큰 분석 과정 **/
    const sourceLogs = await this.getTransferLogsInSource(depositorAddress, srcTx.logs);
    let sourceTokenName = 'ETH', sourceTokenSymbol = 'ETH';
    if (sourceLogs) { //token으로 전송하는 경우.
      const { tokenName, tokenSymbol } = await this.getTokenInfo(sourceToken, sourceProvider);
      sourceTokenName = tokenName;
      sourceTokenSymbol = tokenSymbol;
    }
    const sourceTx = { "address": depositorAddress, "id": sourceTokenSymbol, "name": sourceTokenName, "chain": srcChain, "value": inputAmount.toString(),
      "timestamp": srcTimeStamp, "hash": layerData.source.tx.txHash};

    const destTx = await destinationProvider.getTransactionReceipt(layerData.destination.tx.txHash);
    const destTimeStamp = await this.getTimeStamp('0x'+destTx.blockNumber.toString(16), destChain);
    const destinationLogs = await this.getBridgeLogsInDestination(destTx.logs);
    let destinationTokenName = 'ETH', destinationTokenSymbol = 'ETH';
    let outputAmount, destinationTx;
    if (destinationLogs) {
      const destinationToken = '0x' + destinationLogs.topics[3].slice(-40);
      const { tokenName, tokenSymbol } = await this.getTokenInfo(destinationToken, sourceProvider);
      destinationTokenName = tokenName;
      destinationTokenSymbol = tokenSymbol;
      const amountOutHex = '0x' + destinationLogs.data.slice(-64);  // Last 32 bytes
      outputAmount = BigInt(parseInt(amountOutHex, 16));
    }

    destinationTx = { "address": recipientAddress, "id": destinationTokenSymbol, "name": destinationTokenName, "chain": destChain, "value": outputAmount.toString(),
      "timestamp": destTimeStamp, "hash": layerData.destination.tx.txHash};

    const { transactionGroups, tokenGroups } = await this.makeResponseGroups(destChain, recipientAddress, destTx.blockNumber);
    const response = this.makeResponse("LayerZero", sourceTx, destinationTx, transactionGroups, tokenGroups);
    console.log(response);
    return response;
  }

  async getRecipientTxListFromClaim(layerData) { //src: 로그 / dest: 로그
    const sourceProvider = this.selectProvider(layerData.pathway.sender.chain);
    const destinationProvider = this.selectProvider(layerData.pathway.receiver.chain);

    const depositorAddress = layerData.source.tx.from;
    const srcTx = await this.getTxReceipt(layerData.source.tx.txHash);
    const claimLogs = await this.getClaimLogsInSource(srcTx.logs);
    const recipientAddress = '0x' + claimLogs.data.slice(0, 66).slice(-40);  // First 32 bytes
    const srcTimeStamp = await this.getTimeStamp(srcTx.blockNumber.toString(), layerData.pathway.sender.chain);

    const sourceTx = { "address": depositorAddress, "id": 'X', "name": 'X', "chain": layerData.pathway.sender.chain, "value": '0',
      "timestamp": srcTimeStamp, "hash": layerData.source.tx.txHash};

    const destTx = await destinationProvider.getTransactionReceipt(layerData.destination.tx.txHash);
    const destTimeStamp = await this.getTimeStamp('0x'+destTx.blockNumber.toString(16), layerData.pathway.receiver.chain);

    const destinationLogs = await this.getTransferLogsInDestination(recipientAddress, destTx.logs);
    const { tokenName: destinationTokenName, tokenSymbol: destinationTokenSymbol } = await this.getTokenInfo(destinationLogs.address, destinationProvider);
    const outputAmount = BigInt(parseInt(destinationLogs.data,16));
    const destinationTx = { "address": recipientAddress, "id": destinationTokenSymbol, "name": destinationTokenName, "chain": layerData.pathway.receiver.chain, "value": outputAmount.toString(),
      "timestamp": destTimeStamp, "hash": layerData.destination.tx.txHash};

    const { transactionGroups, tokenGroups } = await this.makeResponseGroups(layerData.pathway.receiver.chain, recipientAddress, destTx.blockNumber);
    const response = this.makeResponse("LayerZero", sourceTx, destinationTx, transactionGroups, tokenGroups);

    console.log(response);
    return response;
  }

  async getRecipientTxListFromLayerZero(layerData) { //src: 커스텀 로그 / dest: 커스텀 로그
    const sourceProvider = this.selectProvider(layerData.pathway.sender.chain);
    const destinationProvider = this.selectProvider(layerData.pathway.receiver.chain);

    const depositorAddress = layerData.source.tx.from;
    const srcTx = await this.getTxReceipt(layerData.source.tx.txHash);
    const srcTimeStamp = await this.getTimeStamp(srcTx.blockNumber.toString(), layerData.pathway.sender.chain);

    const LayerZeroLogs = await this.getLayerZeroLogsInSource(srcTx.logs);
    const recipientAddress = '0x' + LayerZeroLogs.data.slice(26, 66);  // Extract the second 32 bytes (to address)
    const zroAmountHex = '0x' + LayerZeroLogs.data.slice(66, 130);  // Extract the third 32 bytes (zroAmount)
    const inputAmount = BigInt(zroAmountHex);  // Convert zroAmount to BigInt

    const sourceTx = {"address": depositorAddress, "id": 'ZRO', "name": 'LayerZero', "chain": layerData.pathway.sender.chain, "value": inputAmount.toString(),
      "timestamp": srcTimeStamp, "hash": layerData.source.tx.txHash};

    const destTx = await destinationProvider.getTransactionReceipt(layerData.destination.tx.txHash);
    const destTimeStamp = await this.getTimeStamp('0x'+destTx.blockNumber.toString(16), layerData.pathway.receiver.chain);
    const destinationLogs = await this.getLayerZeroLogsInDestination(destTx.logs);
    const actualAmountHex = '0x' + destinationLogs.data.slice(130, 194);
    const outputAmount = BigInt(parseInt(actualAmountHex, 16));
    const destinationTx = {"address": recipientAddress, "id": 'ZRO', "name": 'LayerZero', "chain": layerData.pathway.receiver.chain, "value": outputAmount.toString(),
      "timestamp": destTimeStamp, "hash": layerData.destination.tx.txHash};
    const { transactionGroups, tokenGroups } = await this.makeResponseGroups(layerData.pathway.receiver.chain, recipientAddress, destTx.blockNumber);
    const response = this.makeResponse("LayerZero", sourceTx, destinationTx, transactionGroups, tokenGroups);

    console.log(response);
    return response;
  }

  async getRecipientTxListFromDrive(layerData) { //src: 로그 / dest: 로그
    const sourceProvider = this.selectProvider(layerData.pathway.sender.chain);
    const destinationProvider = this.selectProvider(layerData.pathway.receiver.chain);

    const srcTx = await this.getTx(layerData.source.tx.txHash, layerData.pathway.sender.chain);
    const srcTimeStamp = await this.getTimeStamp(srcTx.blockNumber.toString(), layerData.pathway.sender.chain);
    const depositorAddress = layerData.source.tx.from;
    const sourceTx = { "address": depositorAddress, "id": 'ETH', "name": 'ETH', "chain": layerData.pathway.sender.chain, "value": parseInt(srcTx.value.toString(),16).toString(),
      "timestamp": srcTimeStamp, "hash": layerData.source.tx.txHash};

    const destTx = await destinationProvider.getTransactionReceipt(layerData.destination.tx.txHash);
    const destTimeStamp = await this.getTimeStamp('0x'+destTx.blockNumber.toString(16), layerData.pathway.receiver.chain);

    const destinationLogs = await this.getTransferLogsInDestination("", destTx.logs);
    let destinationTx, recipientAddress, outputAmount;

    let destinationTokenName = "ETH", destinationTokenSymbol = "ETH";
    if(destinationLogs) { // Transfer로그 있고 토큰 전송
      recipientAddress = '0x' + destinationLogs.topics[2].slice(-40);
      const { tokenName, tokenSymbol } = await this.getTokenInfo(destinationLogs.address, destinationProvider);
      destinationTokenName = tokenName;
      destinationTokenSymbol = tokenSymbol;
      outputAmount = BigInt(parseInt(destinationLogs.data,16));
    }
    else { // (Transfer 로그가 없이 ETH전송)
      const oftLogs = await this.getOFTReceivedLogsInDestination(destTx.logs);
      recipientAddress = '0x' + oftLogs.topics[2].slice(-40);
      const outputAmountHex = '0x' + oftLogs.data.slice(66);  // Second 32 bytes
      outputAmount = BigInt(parseInt(outputAmountHex,16));  // Convert to string for large numbers
    }

    destinationTx = { "address": recipientAddress, "id": destinationTokenSymbol, "name": destinationTokenName, "chain": layerData.pathway.receiver.chain, "value": outputAmount.toString(),
      "timestamp": destTimeStamp, "hash": layerData.destination.tx.txHash};

    const { transactionGroups, tokenGroups } = await this.makeResponseGroups(layerData.pathway.receiver.chain, recipientAddress, destTx.blockNumber);
    const response = this.makeResponse("LayerZero", sourceTx, destinationTx, transactionGroups, tokenGroups);
    console.log(response)
    return response;
  }

  async getRecipientTxListFromLifi(layerData) { //src: 로그 / dest: 로그
    const sourceProvider = this.selectProvider(layerData.pathway.sender.chain);
    const destinationProvider = this.selectProvider(layerData.pathway.receiver.chain);
    const srcTx = await this.getTxReceipt(layerData.source.tx.txHash);
    const srcTimeStamp = await this.getTimeStamp(srcTx.blockNumber.toString(), layerData.pathway.sender.chain);

    const depositorAddress = layerData.source.tx.from;
    const sourceLogs = await this.getTransferLogsInSource(depositorAddress, srcTx.logs);
    const inputAmount = BigInt(parseInt(sourceLogs.data,16));
    const { tokenName: sourceTokenName, tokenSymbol: sourceTokenSymbol } = await this.getTokenInfo(sourceLogs.address, sourceProvider);
    const sourceTx = { "address": depositorAddress, "id": sourceTokenSymbol, "name": sourceTokenName, "chain": layerData.pathway.sender.chain, "value": inputAmount.toString(),
      "timestamp": srcTimeStamp, "hash": layerData.source.tx.txHash};

    const destTx = await destinationProvider.getTransactionReceipt(layerData.destination.tx.txHash);
    const destTimeStamp = await this.getTimeStamp('0x'+destTx.blockNumber.toString(16), layerData.pathway.receiver.chain);

    const LifiLogs = await this.getLiFiLogsInDestination(destTx.logs);
    const decodedLogData = await this.getDecodedLogsForLifi(LifiLogs)
    const recipientIdx = decodedLogData.fragment.inputs.findIndex(param => param.name === 'to');
    const recipientAddress = "0x" + decodedLogData.args[recipientIdx].slice(-40);
    const destinationLogs = await this.getTransferLogsInDestination(recipientAddress, destTx.logs);
    const { tokenName: destinationTokenName, tokenSymbol: destinationTokenSymbol } = await this.getTokenInfo(destinationLogs.address, destinationProvider);
    const outputAmount = BigInt(parseInt(destinationLogs.data,16));

    const destinationTx = {"address": recipientAddress, "id": destinationTokenSymbol, "name": destinationTokenName, "chain": layerData.pathway.receiver.chain, "value": outputAmount.toString(),
      "timestamp": destTimeStamp, "hash": layerData.destination.tx.txHash};
    const { transactionGroups, tokenGroups } = await this.makeResponseGroups(layerData.pathway.receiver.chain, recipientAddress, destTx.blockNumber);
    const response = this.makeResponse("LayerZero", sourceTx, destinationTx, transactionGroups, tokenGroups);
    console.log(response)
    return response;
  }

  async getRecipientTxListFromRango(layerData) {
    const sourceProvider = this.selectProvider(layerData.pathway.sender.chain);
    const destinationProvider = this.selectProvider(layerData.pathway.receiver.chain);

    const srcTx = await this.getTxReceipt(layerData.source.tx.txHash);
    const srcTimeStamp = await this.getTimeStamp(srcTx.blockNumber.toString(), layerData.pathway.sender.chain);

    const depositorAddress = layerData.source.tx.from;
    const sourceLogs = await this.getTransferLogsInSource(depositorAddress, srcTx.logs);
    const inputAmount = BigInt(parseInt(sourceLogs.data,16));
    const { tokenName: sourceTokenName, tokenSymbol: sourceTokenSymbol } = await this.getTokenInfo(sourceLogs.address, sourceProvider);
    const sourceTx = { "address": depositorAddress, "id": sourceTokenSymbol, "name": sourceTokenName, "chain": layerData.pathway.sender.chain, "value": inputAmount.toString(),
      "timestamp": srcTimeStamp, "hash": layerData.source.tx.txHash};

    const destTx = await destinationProvider.getTransactionReceipt(layerData.destination.tx.txHash);
    const destTimeStamp = await this.getTimeStamp('0x'+destTx.blockNumber.toString(16), layerData.pathway.receiver.chain);

    const rangoLogs = await this.getRangoLogsInDestination(destTx.logs);
    const decodedSendTokenData = await this.getDecodedSendTokenEventForRango(rangoLogs)
    const recipientIdx = decodedSendTokenData.fragment.inputs.findIndex(param => param.name === '_receiver');
    const recipientAddress = decodedSendTokenData.args[recipientIdx];
    const outputAmountIdx = decodedSendTokenData.fragment.inputs.findIndex(param => param.name === '_amount');
    const outputAmount = BigInt(decodedSendTokenData.args[outputAmountIdx]);
    const withdrawalLogs = await this.getWithdrawalLogsInDestination(destTx.logs);
    const { tokenName: destinationTokenName, tokenSymbol: destinationTokenSymbol } = await this.getTokenInfo(withdrawalLogs.address, destinationProvider);
    const destinationTx = { "address": recipientAddress, "id": destinationTokenSymbol, "name": destinationTokenName, "chain": layerData.pathway.receiver.chain, "value": outputAmount.toString(),
      "timestamp": destTimeStamp, "hash": layerData.destination.tx.txHash};

    const { transactionGroups, tokenGroups } = await this.makeResponseGroups(layerData.pathway.receiver.chain, recipientAddress, destTx.blockNumber);
    const response = this.makeResponse("LayerZero", sourceTx, destinationTx, transactionGroups, tokenGroups);
    console.log(response)
    return response;
  }

  async getRecipientTxListFromAcross(srcTxHash: string, chain: string) { /** Across 프로토콜은 조금 다름 **/
    const srcTx = await this.getTxReceipt(srcTxHash);
    const srcTimeStamp = await this.getTimeStamp(srcTx.blockNumber.toString(), 'ethereum');

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


    const { tokenName, tokenSymbol } = await this.getTokenInfo(tokenAddress, this.mainnetProvider);
    const sourceTx = { "address": depositorAddress, "id": tokenSymbol, "name": tokenName, "chain": "ethereum", "value": inputAmount.toString(),
      "timestamp": srcTimeStamp, "hash": srcTxHash};
    const destinationTx = {"address":recipientAddress, "id": tokenSymbol, "name":tokenName, "chain": chain, "value": outputAmount.toString()};
    const { transactionGroups, tokenGroups } = await this.makeResponseGroups(chain, recipientAddress, await this.getBlockNumberByTimeStamp(timeStamp));
    const response = this.makeResponse("Across", sourceTx, destinationTx, transactionGroups, tokenGroups);
    console.log(response)
    return response;
  }

  private async getTokenInfoInTransferLogs(sourceLogs, sourceProvider: Provider) {
    let sourceTokenName = "ETH", sourceTokenSymbol = "ETH";
    if (sourceLogs) { //token으로 전송하는 경우.
      const { tokenName, tokenSymbol } = await this.getTokenInfo(sourceLogs.address, sourceProvider);
      sourceTokenName = tokenName;
      sourceTokenSymbol = tokenSymbol;
    }
    return { sourceTokenName, sourceTokenSymbol };
  }

  private async parseInputData(abi, srcTxHash: string, sourceProvider: Provider) {
    const decodedInputData = await this.getDecodedInputData(abi, srcTxHash, sourceProvider);
    /** inputAmount를 조회하기 위해 inputData를 파싱합니다.**/
      // ProxyOFT일경우 logs -> params 조회
    let inputAmountIdx = decodedInputData.fragment.inputs.findIndex(param => param.name === "_amount");
    let inputAmount;
    if (inputAmountIdx == -1) {
      // OFT일경우 logs -> components 조회
      const OFTData = decodedInputData.fragment.inputs.find(param => param.name === "_sendParam");
      inputAmountIdx = OFTData.components.findIndex(param => param.name === "amountLD");
      if (inputAmountIdx == -1) {
        // OKX Proxy일경우 logs -> components 조회
        const ProxyData = decodedInputData.fragment.inputs.find(param => param.name === "_request");
        inputAmountIdx = ProxyData.components.findIndex(param => param.name === "amount");
      }
      inputAmount = BigInt(decodedInputData.args.at(0)[inputAmountIdx]);
    } else {
      inputAmount = BigInt(decodedInputData.args[inputAmountIdx]);
    }
    return { decodedInputData, inputAmountIdx, inputAmount };
  }

  private getRecipientAddressFromOFT(decodedInputData: TransactionDescription, inputAmountIdx: number) {
    let recipientIndex = decodedInputData.fragment.inputs.findIndex(param => param.name === "_toAddress");
    if (recipientIndex == -1) {
      const OFTData = decodedInputData.fragment.inputs.find(param => param.name === "_sendParam");
      recipientIndex = OFTData.components.findIndex(param => param.name === "to");
      if (inputAmountIdx == -1) {
        /** OKX Proxy일경우 logs -> components 조회**/
        const ProxyData = decodedInputData.fragment.inputs.find(param => param.name === "_request");
        recipientIndex = ProxyData.components.findIndex(param => param.name === "to");
      }
      return "0x" + decodedInputData.args.at(0)[recipientIndex].slice(-40);
    } else {
      return "0x" + decodedInputData.args[recipientIndex].slice(-40);
    }
  }


  async getLayerZeroScanInfo(txHash: string) {
    const url = `https://scan.LayerZero-api.com/v1/messages/tx/${txHash}`;
    const { data } = await firstValueFrom(
      this.httpService.get(url).pipe(
        catchError((error: AxiosError) => {
          const errMsg = "Failed to fetch transaction history from LayerZeroScan\nMessage: " + error.message;
          console.log(errMsg);
          throw new LayerZeroError(errMsg);
        })
      )
    );
    return data.data[0];
  }

  private async getTokenInfo(tokenAddress: string, provider: Provider) {
    if(tokenAddress === '0x0000000000000000000000000000000000000000')
      return { tokenName: 'unknown', tokenSymbol: 'unknown' };
    else if(tokenAddress === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')
      return { tokenName: 'ETH', tokenSymbol: 'ETH' };
    try {
      const tokenContract = new Contract(tokenAddress, ["function name() view returns (string)", "function symbol() view returns (string)"], provider);
      const tokenName = await tokenContract.name();
      const tokenSymbol = await tokenContract.symbol();
      return { tokenName, tokenSymbol };
    } catch (e) {
      return { tokenName: 'unknown', tokenSymbol: 'unknown' }
    }

  }

  private async getDecodedInputData(abi, srcTxHash: string, sourceProvider: Provider) {
    const decoder = new ethers.Interface(abi);
    const tx = await sourceProvider.getTransaction(srcTxHash);
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


  private async getContractABI(srcTx, chain: string) {
    let url = '';
    if (chain === "bsc")
      url = `https://api.bscscan.com/api?module=contract&action=getabi&address=${srcTx.to}&apikey=${BNBSCAN_API_KEY}`;
    else if (chain === "arbitrum")
      url = `https://api.arbiscan.io/api?module=contract&action=getabi&address=${srcTx.to}&apikey=${ARBITRUM_API_KEY}`;
    else if (chain === "ethereum")
      url = `https://api.etherscan.io/api?module=contract&action=getabi&address=${srcTx.to}&apikey=${ETHEREUM_API_KEY}`;
    else {
      throw new Error("Unsupported chain");
    }
    const { data } = await firstValueFrom(
      this.httpService.get(url).pipe(
        catchError((error: AxiosError) => {
          const errMsg = "Failed to fetch transaction history from " + chain + " API\nMessage: " + error.message;
          console.log(errMsg);
          throw new Error(errMsg);
        })
      )
    );
    const abi = JSON.parse(data.result);
    return abi;
  }

  private async getTx(txHash: string, chain: string) {
    const requestBody = {
      jsonrpc: "2.0",
      method: "eth_getTransactionByHash",
      params: [`${txHash}`],
      id: 1
    };

    let url = this.mainnetUrl;
    if(chain === 'bsc')
      url = this.bnbUrl;
    else if(chain === 'arbitrum')
      url = this.arbiUrl;
    else if(chain === 'base')
      url = this.baseUrl;

    const { data } = await firstValueFrom(
      this.httpService.post(url, requestBody).pipe(
        catchError((error: AxiosError) => {
          const errMsg = "Failed to fetch transaction history from " + chain + " RPC\nMessage: " + error.message;
          console.log(errMsg);
          throw new Error(errMsg);
        })
      )
    );
    return data.result;
  }

  private async getTxReceipt(txHash: string, chain?: string): Promise<null | TransactionReceipt>{
    const requestBody = {
      jsonrpc: "2.0",
      method: "eth_getTransactionReceipt",
      params: [`${txHash}`],
      id: 1
    };

    let url = this.mainnetUrl;
    if(chain === 'bsc')
      url = this.bnbUrl;
    else if(chain === 'arbitrum')
      url = this.arbiUrl;
    else if (chain === "base")
      url = this.baseUrl;

    const { data } = await firstValueFrom(
      this.httpService.post(url, requestBody).pipe(
        catchError((error: AxiosError) => {
          const errMsg = "Failed to fetch transaction history from " + chain + " RPC\nMessage: " + error.message;
          console.log(errMsg);
          throw new Error(errMsg);
        })
      )
    );
    return data.result;
  }

  private async getTimeStamp(blockNumber: string, chain: string){
    const requestBody = {
      jsonrpc: "2.0",
      method: "eth_getBlockByNumber",
      params: [blockNumber, false],
      id: 1
    };

    let url = this.mainnetUrl;
    if(chain === 'bsc')
      url = this.bnbUrl;
    else if(chain === 'arbitrum')
      url = this.arbiUrl;
    else if (chain === "base")
      url = this.baseUrl;

    const { data } = await firstValueFrom(
      this.httpService.post(url, requestBody).pipe(
        catchError((error: AxiosError) => {
          const errMsg = "Failed to fetch transaction history from " + chain + " RPC\nMessage: " + error.message;
          console.log(errMsg);
          throw new Error(errMsg);
        })
      )
    );
    if(!data.result.timestamp)
      throw new Error("[네트워크 불안정] blockNumber에서 timestamp를 추출하는데 RPC 요청이 제대로 되지 않음. 이는 재시도를 하면 해결 됨. 네트워크 불안정이 원인")
    return parseInt(data.result.timestamp,16) * 1000;
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

  private async getBridgeLogsInDestination(logs) {
    const transferCode = '0x2db5ddd0b42bdbca0d69ea16f234a870a485854ae0d91f16643d6f317d8b8994';
    return logs
      .filter(log => log.topics[0] === transferCode)[0];
  }

  private async getClaimLogsInSource(logs) {
    const transferCode = '0xace6f3f8956413e2875b9070e2616d13687dfb251cf63b343028c32822dfa263';
    return logs
      .filter(log => log.topics[0] === transferCode)[0];
  }

  private async getLayerZeroLogsInSource(logs) {
    const transferCode = '0xa249b2de7880ddae7545b21bb8c53b5d091a775a6af75203985e48e2bde60760';
    return logs
      .filter(log => log.topics[0] === transferCode)[0];
  }

  private async getLayerZeroLogsInDestination(logs) {
    const transferCode = '0x82e45245d12a20ddee81f5c5b25c8407b35b1f59ee3fce43c791e342b145b4e5';
    return logs
      .filter(log => log.topics[0] === transferCode)[0];
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

  private async getTxListByAddress(address: string, blockNumber: string, chain: string) {
    if (address.length > 40)
      address = "0x" + address.slice(-40);

    let url = '';
    let chainName = '';

    // 체인별로 URL과 체인명 설정
    switch (chain) {
      case 'bsc':
        url = `https://api.bscscan.com/api?module=account&action=txlist&address=${address}&page=1&offset=5&sort=asc&startblock=${blockNumber}&endblock=99999999&apikey=${BNBSCAN_API_KEY}`;
        chainName = 'bsc';
        break;
      case 'arbitrum':
        url = `https://api.arbiscan.io/api?module=account&action=txlist&address=${address}&page=1&offset=5&sort=asc&startblock=${blockNumber}&endblock=latest&apikey=${ARBITRUM_API_KEY}`;
        chainName = 'arbitrum';
        break;
      case 'ethereum':
        url = `https://api.etherscan.io/api?module=account&action=txlist&address=${address}&page=1&offset=5&sort=asc&startblock=${blockNumber}&endblock=99999999&apikey=${ETHEREUM_API_KEY}`;
        chainName = 'ethereum';
        break;
      case 'base':
        url = `https://api.basescan.org/api?module=account&action=txlist&address=${address}&page=1&offset=5&sort=asc&startblock=${blockNumber}&endblock=99999999&apikey=${BASE_API_KEY}`;
        chainName = 'base';
        break;
      default:
        throw new Error("Unsupported chain");
    }

    const { data } = await firstValueFrom(
      this.httpService.get(url).pipe(
        catchError((error: AxiosError) => {
          const errMsg = "Failed to fetch transaction history from " + chain + "\nMessage: " + error.message;
          console.log(errMsg);
          throw new Error(errMsg);
        })
      )
    );

    for (const tx of data.result) {
      tx.chain = chainName; // 구분을 위한 체인명 삽입
    }
    if (data.message === "OK") {
      return data.result;
    } else {
      console.log(data.message);
      return '';
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

  private selectProvider(chain: string) {
    let provider: Provider;
    if (chain === "bsc")
      provider = this.bnbProvider;
    else if (chain === "arbitrum")
      provider = this.arbitrumProvider;
    else if (chain === "ethereum")
      provider = this.mainnetProvider;
    else if (chain === "base")
      provider = this.baseProvider;
    return provider;
  }

  async makeResponseGroups(chain: string, recipientAddress: string, blockNumber: number) {
    const provider = this.selectProvider(chain);
    const [transactions, tokens] = await Promise.all([
      this.getTxListByAddress(recipientAddress, String(blockNumber), chain),
      []
    ]);

    for (const tx of transactions) {
      let data = await provider.getTransactionReceipt(tx.hash);
      tx.methodNames = []; // methodNames 배열 초기화

      for (const log of data.logs) {
        const methodName = this.getMethodName(log.topics[0]);
        if(methodName === 'Transfer') {
          const { tokenName, tokenSymbol } = await this.getTokenInfo(log.address, provider);
          tx.methodNames.push({
            methodName: methodName,
            address: log.address,
            tokenName: tokenName,
            tokenSymbol: tokenSymbol,
            value: tokenSymbol==='USDC'?(parseInt(log.data, 16) / 1e6).toLocaleString():Number((parseInt(log.data, 16) / 10**18).toFixed(4)).toLocaleString()
          });
        }
        else {
          tx.methodNames.push({
            methodName: methodName,
            address: log.address
          });
        }
      }
    }

    const transactionGroups = [];
    const tokenGroups = [];
    if (transactions)
      transactionGroups.push(transactions);
    return { transactionGroups, tokenGroups };
  }

  private makeResponse(protocol, sourceTx, destinationTx, transactionGroups, tokenGroups) {
    const response = [];
    response.push({
      "protocol": protocol,
      "sourceTx": sourceTx,
      "destinationTx": destinationTx,
      "transactionGroups": transactionGroups,
      "tokenGroups": tokenGroups
    });
    return response;
  }

  private getMethodId(srcTx) {
    const inputData = srcTx.input; // 트랜잭션의 input data
    return inputData.slice(0, 10); // 첫 10글자를 MethodID로 추출 (0x + 4바이트)
  }

  private getMethodName(signature: string) {
    return EventDictionary.getName(signature);
  }

  async getTransactionInfoFromRange(txHash: string) {
    const url = 'https://usdc.range.org/usdc/api/transfers';
    const { data } = await firstValueFrom(
      this.httpService.get(url, {
        params: {
          txHash,
          txnType: 'MAINNET',
          limit: 1,
          direction: 'first',
          source: 'ethereum,base,arbitrum',
          destination: 'ethereum,base,arbitrum',
          status: '',
          min_usd: '',
          max_usd: ''
        }
      }).pipe(
        catchError((error: AxiosError) => {
          const errMsg = "Failed to fetch transaction info from Range API\nMessage: " + error.message;
          console.error(errMsg);
          throw new CCTPapiError(errMsg);
        })
      )
    );
    return data.resources[0];
  }

  private async getUsdcTransferLogsInSource(chain: string, depositorAddress: string, recipientAddress: string, logs) {
    const transferCode = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const filteredLog = logs
      .filter(log => log.topics[0] === transferCode
        && log.address.toLowerCase() === USDC_ADDRESSES_MAP[chain]
        && '0x' + log.topics[1].slice(-40).toLowerCase() === recipientAddress
        && '0x' + log.topics[2].slice(-40).toLowerCase() === depositorAddress);
    return filteredLog[0];
  }

  async getRecipientTxListFromCCTP(txInfo) {
    const srcChain = txInfo.from_network;
    const srcHash = txInfo.burn_hash
    const srcTx = await this.getTxReceipt(srcHash, srcChain);
    const srcTimeStamp = new Date(txInfo.from_timestamp).getTime();
    const depositorAddress = txInfo.from;
    const sourceLogs = await this.getUsdcTransferLogsInSource(srcChain, depositorAddress.toLowerCase(), txInfo.destination.toLowerCase(), srcTx.logs);
    let inputAmount = txInfo.amount;
    if (sourceLogs) inputAmount = BigInt(parseInt(sourceLogs.data, 16)).toString();
    const sourceTx = {
      "address": depositorAddress,
      "id": 'USDC',
      "name": 'USDC',
      "chain": srcChain,
      "value": inputAmount,
      "timestamp": srcTimeStamp,
      "hash": srcHash
    };
    const destChain = txInfo.destination_network;
    const destHash = txInfo.transfer_hash;
    const destTimeStamp = new Date(txInfo.destination_timestamp).getTime();
    const receiptAddress = txInfo.destination;
    const destinationTx = {
      "address": receiptAddress,
      "id": 'USDC',
      "name": 'USDC',
      "chain": destChain,
      "value": txInfo.amount,
      "timestamp": destTimeStamp,
      "hash": destHash
    };
    const { transactionGroups, tokenGroups } = await this.makeResponseGroups(destChain, receiptAddress, parseInt(txInfo.destination_block));
    const response = this.makeResponse("CCTP", sourceTx, destinationTx, transactionGroups, tokenGroups);
    console.log(response)
    return response;
  }

  public async fetchAndParseHtml(hash: string): Promise<any | null> {
    const url = `https://usdc.range.org/usdc/status/${hash}`;
    try {
      const response = await axios.get(url);
      const html: string = response.data;
      const $ = cheerio.load(html);
      //console.log($.html());
      //console.log($('script'));
      const scriptTags = $('script').toArray();
      let jsonData = null;
      for (const el of scriptTags) {
        const ch = el.children;
        for (const ele of ch) {
          if (ele.type === 'text' && ele.data) {
            const match = ele.data.match(/"data\\":\s*(\{.*?\})\s*\}/s);
            if (match !== null) {
              try {
                const cleanJson = match[1].replace(/\\\"/g, '"');
                jsonData = JSON.parse(cleanJson);
                break;
              } catch (error) {
                console.error("Failed to parse JSON:", error);
                return null;
              }
            }
          }
        }
        if (jsonData) break;
      }
      if (!jsonData) {
        console.error("No JSON data found in HTML.");
        return null;
      }
      // 데이터 정제
      const srcTx = jsonData.burn_hash;
      const srcChain = jsonData.from_network;
      const srcTimeStamp = new Date(jsonData.from_timestamp).getTime();
      const depositorAddress = jsonData.from;
      const inputAmount = jsonData.amount;
      const sourceTx = {
        address: depositorAddress,
        id: 'USDC',
        name: 'USDC',
        chain: srcChain,
        value: inputAmount,
        timestamp: srcTimeStamp,
        hash: srcTx,
      };

      const destChain = jsonData.destination_network;
      const destHash = jsonData.transfer_hash;
      const destTimeStamp = new Date(jsonData.destination_timestamp).getTime();
      const receiptAddress = jsonData.destination;
      const destinationTx = {
        address: receiptAddress,
        id: 'USDC',
        name: 'USDC',
        chain: destChain,
        value: inputAmount,
        timestamp: destTimeStamp,
        hash: destHash,
      };
      const { transactionGroups, tokenGroups } = await this.makeResponseGroups(
        destChain,
        receiptAddress,
        parseInt(jsonData.destination_block)
      );

      // 최종 응답 생성
      const crawlResponse = this.makeResponse(
        'CCTP',
        sourceTx,
        destinationTx,
        transactionGroups,
        tokenGroups
      );

      console.log(crawlResponse);
      return crawlResponse;
    } catch (error: any) {
      console.error('Error fetching or parsing HTML:', error.message);
      return null;
    }
  }
}