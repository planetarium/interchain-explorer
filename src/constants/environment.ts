import dotenv from "dotenv";
dotenv.config({ path: '.env.development' });

export const ETHEREUM_API_KEY = process.env.ETHEREUM_API_KEY!;
export const BNBSCAN_API_KEY = process.env.BNBSCAN_API_KEY!;
export const INFURA_API_KEY = process.env.INFURA_API_KEY!;
export const ARBITRUM_API_KEY = process.env.ARBITRUM_API_KEY!;
