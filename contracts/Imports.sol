//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Import contracts so that they can be deployed in the tests.
import { GatewayRegistryV2 } from "@renproject/gateway-sol/src/GatewayRegistry/GatewayRegistry.sol";
import { RenAssetV2 } from "@renproject/gateway-sol/src/RenAsset/RenAsset.sol";
import { MintGatewayV3 } from "@renproject/gateway-sol/src/Gateways/MintGateway.sol";
import { LockGatewayV3 } from "@renproject/gateway-sol/src/Gateways/LockGateway.sol";
import { TransferWithLog } from "@renproject/gateway-sol/src/TransferWithLog.sol";
import { TestToken } from "@renproject/gateway-sol/src/testUtils/TestToken.sol";
import { BasicBridge } from "@renproject/gateway-sol/src/BasicBridge.sol";
