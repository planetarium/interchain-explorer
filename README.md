# Interchain Explorer

## Description

Tracks user's activities on destination chain after bridging on source chain.

Supporting bridges:
- LayerZero

Supporting networks:
- Ethereum
- BNB Smart Chain

Supporting tokens:
- WNCG (Nine Chronicles)

**https://bridgetracer.planetariumlabs.com**

![image](https://github.com/user-attachments/assets/30416d7e-b5e5-46cc-bb8c-438a5e8423c9)

## Requirements
- Node.js >= v22.5.1

## Installation

```bash
$ npm install
```

## Running the app

```bash
# watch mode
$ npm run start:dev
```

## Deployment
- Deployed on AWS Lambda (Serverless)

## Stack
- Backend: Nest.js, AWS Lambda (Serverless)
- Frontend: HTML, CSS, JS
- Blockchain: Ethereum, Arbitrum, BNB Smart Chain, Across, LayerZero, ... to be added
- API: Etherscan, Arbiscan, BSCScan, Infura, LayerZeroScan, Across Bridge API, ... to be added

## References
- https://in-seo.tistory.com/entry/실-서비스를-Nestjs-Serverless-Lambda로-배포해보자
- https://in-seo.tistory.com/entry/Serverless-배포시에-MFA인증-하기