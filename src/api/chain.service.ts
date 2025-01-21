import { Injectable } from '@nestjs/common';
import { InfuraProvider, EtherscanProvider, Provider } from 'ethers';
import { ChainType } from './interfaces';
import { INFURA_API_KEY, BNBSCAN_API_KEY } from '../constants/environment';

@Injectable()
export class ChainService {
  private readonly providers: Map<ChainType, Provider>;
  private readonly rpcUrls: Map<ChainType, string>;

  constructor() {
    this.providers = new Map<ChainType, Provider>([
      ['ethereum', new InfuraProvider('mainnet', INFURA_API_KEY)],
      ['bsc', new EtherscanProvider('bnb', BNBSCAN_API_KEY)],
      ['arbitrum', new InfuraProvider('arbitrum', INFURA_API_KEY)],
      ['base', new InfuraProvider('base', INFURA_API_KEY)]
    ]);

    this.rpcUrls = new Map<ChainType, string>([
      ['ethereum', `https://mainnet.infura.io/v3/${INFURA_API_KEY}`],
      ['bsc', `https://bsc-mainnet.infura.io/v3/${INFURA_API_KEY}`],
      ['arbitrum', `https://arbitrum-mainnet.infura.io/v3/${INFURA_API_KEY}`],
      ['base', `https://base-mainnet.infura.io/v3/${INFURA_API_KEY}`]
    ]);
  }

  getProvider(chain: ChainType): Provider {
    const provider = this.providers.get(chain);
    if (!provider) {
      throw new Error(`Unsupported chain: ${chain}`);
    }
    return provider;
  }

  getRpcUrl(chain: ChainType): string {
    const url = this.rpcUrls.get(chain);
    if (!url) {
      throw new Error(`Unsupported chain: ${chain}`);
    }
    return url;
  }
} 