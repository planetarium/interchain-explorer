import { Injectable } from '@nestjs/common';

@Injectable()
export class MethodMapperService {
  private readonly methodMap: { [key: string]: string } = {
    "0x64e4ac27": "Drive Bus",
    "0x3070c305": "stargateSwapAndBridge",
    "0x3d21e25a": "swapBridgeToV2",
    "0xa6010a66": "swapAndStartBridgeTokensViaStargate",
    "0xc7c7f5b3": "send",
    "0xdda16a10": "sendProxyOFTV2",
    "0x2cdf0b95": "sendFrom",
    "0xddd5e1b2": "claim",
    "0xac6ae3ee": "donateAndClaim",
    "0x5f58d0d3": "swapAndBridge",
    "0x695ef6bf": "sendFrom",
    "0xa8198c00": "sendOFTV2",
    "0x498eff64": "sendOFT",
    "0x8bcb586c": "SendProxyOFTFeeV2",
    "0xe0db3fcf": "deposit"
  };

  // MethodID로 MethodName을 찾는 함수
  getMethodName(methodID: string): string {
    return this.methodMap[methodID] || "Unknown Method";
  }
}
