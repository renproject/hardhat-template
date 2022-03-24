import BigNumber from "bignumber.js";

import { EvmNetworkConfig } from "@renproject/chains-ethereum";

import {
  GatewayRegistryV2__factory,
  RenAssetV2__factory,
  MintGatewayV3__factory,
  LockGatewayV3__factory,
  ProxyBeacon__factory,
  RenVMSignatureVerifierV1__factory,
  TransferWithLog__factory,
  TestToken__factory,
  BasicBridge__factory,
} from "../typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

export const deployGatewaySol = async ({
  deployer,
  chain,
  chainId,
  mintAuthority,
  mintAssets,
  lockAssets,
}: {
  deployer: SignerWithAddress;
  chain: string;
  chainId: number;
  mintAuthority: string;
  mintAssets?: Array<{ symbol: string; decimals: number }>;
  lockAssets?: Array<{ symbol: string; decimals: number; totalSupply: BigNumber }>;
}) => {
  const signatureVerifier = await new RenVMSignatureVerifierV1__factory(deployer).deploy();
  signatureVerifier.__RenVMSignatureVerifier_init(chain, mintAuthority, deployer.address);
  const transferWithLog = await new TransferWithLog__factory(deployer).deploy();
  const renAssetV2 = await new RenAssetV2__factory(deployer).deploy();
  const mintGatewayV3 = await new MintGatewayV3__factory(deployer).deploy();
  const lockGatewayV3 = await new LockGatewayV3__factory(deployer).deploy();
  const renAssetProxyBeacon = await new ProxyBeacon__factory(deployer).deploy(renAssetV2.address, deployer.address);
  const mintGatewayProxyBeacon = await new ProxyBeacon__factory(deployer).deploy(
    mintGatewayV3.address,
    deployer.address,
  );
  const lockGatewayProxyBeacon = await new ProxyBeacon__factory(deployer).deploy(
    lockGatewayV3.address,
    deployer.address,
  );
  const gatewayRegistry = await new GatewayRegistryV2__factory(deployer).deploy();
  await gatewayRegistry.__GatewayRegistry_init(
    chainId,
    signatureVerifier.address,
    transferWithLog.address,
    renAssetProxyBeacon.address,
    mintGatewayProxyBeacon.address,
    lockGatewayProxyBeacon.address,
    deployer.address,
    [deployer.address],
  );
  await renAssetProxyBeacon.updateProxyDeployer(gatewayRegistry.address);
  await mintGatewayProxyBeacon.updateProxyDeployer(gatewayRegistry.address);
  await lockGatewayProxyBeacon.updateProxyDeployer(gatewayRegistry.address);
  const basicBridge = await new BasicBridge__factory(deployer).deploy(gatewayRegistry.address);

  for (const { symbol, decimals } of mintAssets || []) {
    await gatewayRegistry.deployMintGatewayAndRenAsset(symbol, symbol, symbol, decimals, "1");
  }

  for (const { symbol, decimals, totalSupply } of lockAssets || []) {
    const token = await new TestToken__factory(deployer).deploy(
      symbol,
      symbol,
      decimals,
      totalSupply.toFixed(),
      deployer.address,
    );
    await gatewayRegistry.deployLockGateway(symbol, token.address, "1");
  }

  // Set up Ethereum network config.
  const providerNetwork = await deployer.provider?.getNetwork();
  const networkID = providerNetwork ? providerNetwork.chainId : 0;
  return LocalEthereumNetwork(chain, networkID, gatewayRegistry.address, basicBridge.address);
};

// RenJS's Ethereum class can point to a custom network by providing a
// `EthereumConfig` object. `LocalEthereumNetwork` creates the config for
// Hardhat's local network.
const LocalEthereumNetwork = (
  name: string,
  networkID: number,
  gatewayRegistry: string,
  basicAdapter: string,
): EvmNetworkConfig => ({
  selector: name,

  nativeAsset: { name: "Ether", symbol: "ETH", decimals: 18 },
  averageConfirmationTime: 1,

  network: {
    chainId: "0x" + networkID.toString(16),
    chainName: name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["http://localhost:8545"],
    blockExplorerUrls: [""],
  },

  addresses: {
    GatewayRegistry: gatewayRegistry,
    BasicBridge: basicAdapter,
  },
});
