import BigNumber from "bignumber.js";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";

import { Ethereum, EvmNetworkConfig, Polygon } from "@renproject/chains-ethereum";
// RenJS imports
import { MockChain, MockProvider } from "@renproject/mock-provider";
import RenJS from "@renproject/ren";
import { RenVMProvider } from "@renproject/provider";

import {
  BridgeExample,
  BridgeExample__factory,
  GatewayRegistryV2__factory,
  TestToken__factory,
  TestToken,
} from "../typechain";
import { deployGatewaySol } from "./deployGatewaySol";
import { EVMParam } from "@renproject/chains-ethereum/build/main/utils/payloads/evmPayloadHandlers";

chai.use(solidity);
const { expect } = chai;

describe("Token", () => {
  let ethereumBridgeExample: BridgeExample;
  let polygonBridgeExample: BridgeExample;

  let bitcoin: MockChain;
  let ethereumNetwork: EvmNetworkConfig;
  let polygonNetwork: EvmNetworkConfig;
  let renJS: RenJS;
  let mockRenVMProvider: MockProvider;
  let dai: TestToken;

  beforeEach(async () => {
    const [deployer] = await ethers.getSigners();

    ////////////////////////////////////////////////////////////////////////////
    // RenJS set-up ////////////////////////////////////////////////////////////
    ////////////////////////////////////////////////////////////////////////////

    mockRenVMProvider = new MockProvider();
    renJS = new RenJS(new RenVMProvider(mockRenVMProvider));

    // Set up mock Bitcoin chain.
    bitcoin = new MockChain({ chain: "Bitcoin", asset: "BTC" });
    renJS.withChain(bitcoin);
    mockRenVMProvider.registerChain(bitcoin);

    // Get mint authority from mock provider.
    const mintAuthority = mockRenVMProvider.mintAuthority();

    ethereumNetwork = await deployGatewaySol({
      deployer,
      chain: "Ethereum",
      chainId: 1,
      mintAuthority,
      mintAssets: [
        { symbol: "BTC", decimals: 8 },
        { symbol: "ZEC", decimals: 8 },
      ],
      lockAssets: [{ symbol: "DAI", decimals: 18, totalSupply: new BigNumber(1).shiftedBy(18).times(1000) }],
    });
    polygonNetwork = await deployGatewaySol({
      deployer,
      chain: "Polygon",
      chainId: 2,
      mintAuthority,
      mintAssets: [
        { symbol: "BTC", decimals: 8 },
        { symbol: "ZEC", decimals: 8 },
        { symbol: "DAI", decimals: 18 },
      ],
    });

    const ethereumGatewayRegistry = await new GatewayRegistryV2__factory(deployer).attach(
      ethereumNetwork.addresses.GatewayRegistry,
    );
    const daiAddress = await ethereumGatewayRegistry.getLockAssetBySymbol("DAI");
    dai = await new TestToken__factory(deployer).attach(daiAddress);

    ////////////////////////////////////////////////////////////////////////////
    ////////////////////////////////////////////////////////////////////////////
    ////////////////////////////////////////////////////////////////////////////

    // Deploy BridgeExample.
    ethereumBridgeExample = await new BridgeExample__factory(deployer).deploy(
      ethereumNetwork.addresses.GatewayRegistry,
    );
    polygonBridgeExample = await new BridgeExample__factory(deployer).deploy(polygonNetwork.addresses.GatewayRegistry);
  });

  describe("BridgeExample", async () => {
    it("deposit", async () => {
      const [_, user] = await ethers.getSigners();

      if (!user.provider) {
        throw new Error(`User has no connected provider.`);
      }

      const ethereum = new Ethereum({ network: ethereumNetwork, provider: user.provider, signer: user });
      mockRenVMProvider.registerChain(ethereum);
      renJS.withChains(ethereum);

      const polygon = new Polygon({ network: polygonNetwork, provider: user.provider, signer: user });
      mockRenVMProvider.registerChain(polygon);
      renJS.withChains(polygon);

      const decimals = bitcoin.assetDecimals(bitcoin.assets.default);

      // Use random amount.
      const tokenAmount = new BigNumber(Math.random()).decimalPlaces(decimals);
      // Shift the amount by the asset's decimals (8 for BTC).
      const satsAmount = new BigNumber(tokenAmount).times(new BigNumber(10).exponentiatedBy(decimals));

      await dai.transfer(user.address, satsAmount.toFixed());

      const asset = "DAI";

      // Initialize RenJS lockAndMint.
      const gateway = await renJS.gateway({
        // Send BTC from the Bitcoin blockchain to the Ethereum blockchain.
        asset,
        from: ethereum.Account({ amount: satsAmount }),
        // If you change this to another chain, you also have to change the
        // chain name passed to `gatewayFactory` above.
        to: polygon.Contract({
          // The contract we want to interact with
          to: polygonBridgeExample.address,

          // The name of the function we want to call
          method: "deposit",

          // Specify that "deposit" requieres the amount, nHash and signature.
          withRenParams: true,

          // Arguments expected for calling `deposit`
          params: [
            { name: "asset", type: "string", value: asset },
            {
              name: "msg",
              type: "bytes",
              value: Buffer.from(`Depositing ${tokenAmount.toFixed()} ${asset}`),
            },
          ],
        }),
      });

      // Mock deposit. Currently must be passed in as a number.
      // bitcoin.addUTXO(mint.gatewayAddress!, satsAmount.toNumber());

      for (const setup of Object.values(gateway.inSetup)) {
        if (setup.submit) {
          await setup.submit();
        }
        await setup.wait();
      }

      const balanceBefore = await polygonBridgeExample.balance(asset);

      if (gateway.in && gateway.in.submit) {
        await gateway.in.submit();
      }

      await gateway.in?.wait(1);

      // Process the deposit, including the mint step.
      await new Promise<void>((resolve, reject) => {
        gateway.on("transaction", async tx => {
          try {
            await tx.in.wait(0);

            // Submit to mock RenVM
            await tx.renVM.submit();
            await tx.renVM.wait();

            if (tx.out.submit) {
              await tx.out.submit();
            }
            await tx.out.wait(0);

            resolve();
          } catch (error) {
            console.error(error);
            reject(error);
          }
        });
      });

      // Check that the balance of the contract increased by the expected amount.
      const balanceAfter = await polygonBridgeExample.balance(asset);
      const expected = gateway.fees.estimateOutput(satsAmount);
      expect(balanceAfter.sub(balanceBefore)).to.equal(expected.toFixed());
    });

    it("withdraw", async () => {
      const [_, user] = await ethers.getSigners();

      if (!user.provider) {
        throw new Error(`User has no connected provider.`);
      }

      const ethereum = new Ethereum({ network: ethereumNetwork, provider: user.provider, signer: user });
      mockRenVMProvider.registerChain(ethereum);
      renJS.withChains(ethereum);

      const polygon = new Polygon({ network: polygonNetwork, provider: user.provider, signer: user });
      mockRenVMProvider.registerChain(polygon);
      renJS.withChains(polygon);

      const asset = "DAI";

      const decimals = bitcoin.assetDecimals(bitcoin.assets.default);

      const satsAmount = new BigNumber((await polygonBridgeExample.balance(asset)).toString());
      const tokenAmount = satsAmount.shiftedBy(-decimals);

      // Initialize RenJS lockAndMint.
      const gateway = await renJS.gateway({
        asset,
        from: polygon.Contract({
          // The contract we want to interact with
          to: polygonBridgeExample.address,

          // The name of the function we want to call
          method: "withdraw",

          // Specify that "deposit" requieres the amount, nHash and signature.
          withRenParams: false,

          // Arguments expected for calling `deposit`
          params: [
            { name: "asset", type: "string", value: asset },
            {
              name: "msg",
              type: "bytes",
              value: Buffer.from(`Withdrawing ${tokenAmount.toFixed()} ${asset}`),
            },
            {
              name: "to",
              type: "bytes",
              value: EVMParam.EVM_TO_ADDRESS_BYTES,
            },
            { name: "amount", type: "uint256", value: satsAmount.toFixed() },
          ],
        }),
        to: ethereum.Account(),
        // If you change this to another chain, you also have to change the
        // chain name passed to `gatewayFactory` above.
      });

      // Mock deposit. Currently must be passed in as a number.
      // bitcoin.addUTXO(mint.gatewayAddress!, satsAmount.toNumber());

      for (const setup of Object.values(gateway.inSetup)) {
        if (setup.submit) {
          await setup.submit();
        }
        await setup.wait();
      }

      const balanceBefore = await polygonBridgeExample.balance(asset);

      if (gateway.in && gateway.in.submit) {
        await gateway.in.submit();
      }

      await gateway.in?.wait(1);

      // Process the deposit, including the mint step.
      await new Promise<void>((resolve, reject) => {
        gateway.on("transaction", async tx => {
          try {
            await tx.in.wait(0);

            // Submit to mock RenVM
            await tx.renVM.submit();
            await tx.renVM.wait();

            if (tx.out.submit) {
              await tx.out.submit();
            }
            await tx.out.wait(0);

            resolve();
          } catch (error) {
            console.error(error);
            reject(error);
          }
        });
      });

      // Check that the balance of the contract increased by the expected amount.
      const balanceAfter = await polygonBridgeExample.balance(asset);
      const expected = gateway.fees.estimateOutput(satsAmount);

      // TODO: Fix MockProvider fees for releasing
      // expect(balanceBefore.sub(balanceAfter)).to.equal(expected.toFixed());
    });
  });
});
