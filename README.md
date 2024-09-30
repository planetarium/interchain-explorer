# Interchain Explorer

멀티 체인 환경에서 사용자들이 source 트랜잭션 해시를 입력하면 destination 체인에서 발생한 활동을 추적할 수 있는 블록체인 익스플로러

Ethereum, Arbitrum, BNB Smart Chain과 같은 주요 EVM 기반 체인 지원, Across 및 LayerZero 브릿지를 통한 트랜잭션 추적 기능을 제공합니다.

따라서 사용자는 source 트랜잭션 해시값만 입력하면, destination 체인의 트랜잭션/토큰전송 내역 등 어떤 행동들을 했는지 알 수 있습니다.

**https://bridgetracer.planetariumlabs.com**

![image](https://github.com/user-attachments/assets/30416d7e-b5e5-46cc-bb8c-438a5e8423c9)

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
```
$ export AWS_PROFILE=gamefi-dev-poweruser
$ aws configure

$ rm -rf ~/.aws/cli/cache
$ aws sts get-caller-identity
로 assumeRole 되었는지 확인
되었다면

$ cd ~/.aws/cli/cache
$ FILE_NAME=$(grep -rl 'AccessKeyId' .)
$ export AWS_ACCESS_KEY_ID=$(jq -r '.Credentials.AccessKeyId' < "$FILE_NAME") 
$ export AWS_SECRET_ACCESS_KEY=$(jq -r '.Credentials.SecretAccessKey' < "$FILE_NAME") 
$ export AWS_SESSION_TOKEN=$(jq -r '.Credentials.SessionToken' < "$FILE_NAME")
$ unset AWS_PROFILE
$ cd ~/interchain-explorer
$ serverless deploy
```

## Stack
- Backend: Nest.js, AWS Lambda (Serverless)
- Frontend: HTML, CSS, JS
- Blockchain: Ethereum, Arbitrum, BNB Smart Chain, Across, LayerZero, ..추가가능
- API: Etherscan, Arbiscan, BSCScan, Infura, LayerZeroScan, Across Bridge API

## Etc
기여 사항 및 성과
- Serverless 아키텍처로 비용 절감: Nest.js를 활용해 서버리스(Serverless) 아키텍처로 AWS Lambda에 배포하여 서비스 유지 비용을 효과적으로 절감.
- 성능 최적화: 블록체인의 블록 데이터를 직접 저장하지 않고, 체인별 익스플로러 API에서 데이터를 직접 가져와 필요시만 호출한다.
- 기술적 도전:
  - 공통적인 솔루션이 없는 각각의 프로토콜(메서드)을 파싱하는 로직을 단 하나의 API 호출로 실행할 수 있도록 구현. (methodMap)
  - ABI를 통해 InputData, Logs .. 를 디코딩 하는 과정
  - source, destination 체인명을 입력하지 않아도 내부적으로 판단이 가능하도록 구현.
- 확장 가능 설계: 지원하는 체인을 코드 한 줄만 추가하면 확장할 수 있는 구조로 설계하여, 향후 다양한 체인(EVM 외 Solana, Cosmos 등) 및 더 많은 브릿지를 지원할 수 있는 확장 가능성 확보.
- 실제 사용 사례:
  - Planetarium의 WNCG 토큰을 사용하는 유저들의 행동 패턴 분석에 활용 
  - 다른 사람이 과거에 브릿징 한 후 destination chain에서 어떤 행동을 했는지 궁금해하는 사람
- https://in-seo.tistory.com/entry/실-서비스를-Nestjs-Serverless-Lambda로-배포해보자
- https://in-seo.tistory.com/entry/Serverless-배포시에-MFA인증-하기