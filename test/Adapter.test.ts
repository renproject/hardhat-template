import BigNumber from "bignumber.js";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";

import { Ethereum, EthereumConfig } from "@renproject/chains-ethereum";
// RenJS imports
import { MockChain, MockProvider } from "@renproject/mock-provider";
import RenJS from "@renproject/ren";
import { RenVMProvider } from "@renproject/rpc/build/main/v2";

import {
  Adapter,
  Adapter__factory,
  BasicAdapter__factory,
  GatewayFactory__factory,
} from "../typechain";

chai.use(solidity);
const { expect } = chai;

describe("Token", () => {
  let adapter: Adapter;

  let Bitcoin: MockChain;
  let renJS: RenJS;
  let network: EthereumConfig;

  beforeEach(async () => {
    const [deployer, user] = await ethers.getSigners();

    ////////////////////////////////////////////////////////////////////////////
    // RenJS set-up ////////////////////////////////////////////////////////////
    ////////////////////////////////////////////////////////////////////////////

    const mockRenVMProvider = new MockProvider();
    renJS = new RenJS(new RenVMProvider("testnet", mockRenVMProvider));

    // Set up mock Bitcoin chain.
    Bitcoin = new MockChain();
    mockRenVMProvider.registerChain(Bitcoin);

    // Get mint authority from mock provider.
    const mintAuthority = mockRenVMProvider.mintAuthority();

    // Deploy Gateway Factory.
    const gatewayFactory = await new GatewayFactory__factory(deployer).deploy(mintAuthority, "Ethereum");
    const gatewayRegistryAddress = await await gatewayFactory.registry();

    // Deploy BTC and ZEC tokens and gateways.
    await gatewayFactory.addToken("Bitcoin", "BTC", 8);
    await gatewayFactory.addToken("Zcash", "ZEC", 8);

    // Deploy BasicAdapter.
    const basicAdapter = await new BasicAdapter__factory(deployer).deploy(gatewayRegistryAddress);

    // Set up Ethereum network config.
    const providerNetwork = await user.provider?.getNetwork();
    const networkID = providerNetwork ? providerNetwork.chainId : 0;
    network = LocalEthereumNetwork(networkID, gatewayRegistryAddress, basicAdapter.address);

    ////////////////////////////////////////////////////////////////////////////
    ////////////////////////////////////////////////////////////////////////////
    ////////////////////////////////////////////////////////////////////////////

    // Deploy Adapter.
    adapter = await new Adapter__factory(deployer).deploy(gatewayRegistryAddress);
  });

  describe("Mint", async () => {
    it("Should mint some tokens", async () => {
      const [_, user] = await ethers.getSigners();

      // Use random amount.
      const btcAmount = Math.random();
      // Shift the amount by the asset's decimals (8 for BTC).
      const satsAmount = new BigNumber(btcAmount)
        .times(new BigNumber(10).exponentiatedBy(Bitcoin.assetDecimals(Bitcoin.asset)))
        .integerValue(BigNumber.ROUND_DOWN);

      // MockProvider doesn't yet return fee details.
      const fixedFee = 1000; // sats
      const percentFee = 15; // BIPS

      // Initialize RenJS lockAndMint.
      const mint = await renJS.lockAndMint({
        // Send BTC from the Bitcoin blockchain to the Ethereum blockchain.
        asset: "BTC", // `bitcoin.asset`
        from: Bitcoin,
        // If you change this to another chain, you also have to change the
        // chain name passed to `gatewayFactory` above.
        to: Ethereum(user.provider! as any, user, network).Contract({
          // The contract we want to interact with
          sendTo: adapter.address,

          // The name of the function we want to call
          contractFn: "deposit",

          // Arguments expected for calling `deposit`
          contractParams: [
            {
              name: "_msg",
              type: "bytes",
              value: Buffer.from(`Depositing ${btcAmount} BTC`),
            },
          ],
        }),
      });

      // Mock deposit.
      Bitcoin.addUTXO(mint.gatewayAddress!, satsAmount.toNumber());

      const balanceBefore = await adapter.balance();

      // Process the deposit, including the mint step.
      await new Promise<void>((resolve, reject) => {
        mint.on("deposit", async deposit => {
          try {
            await deposit.confirmed();
            await deposit.signed();
            await deposit.mint();
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });

      // Check that the balance of the contract increased by the expected amount.
      const balanceAfter = await adapter.balance();
      const expected = satsAmount
        .minus(fixedFee)
        .times(1 - percentFee / 10000)
        .integerValue(BigNumber.ROUND_UP);
      expect(balanceAfter.sub(balanceBefore)).to.equal(expected.toFixed());
    });
  });
});

// RenJS's Ethereum class can point to a custom network by providing a
// `EthereumConfig` object. `LocalEthereumNetwork` creates the config for
// Hardhat's local network.
const LocalEthereumNetwork = (networkID: number, gatewayRegistry: string, basicAdapter: string): EthereumConfig => ({
  name: "hardhat",
  chain: "hardhat",
  chainLabel: "Hardhat",
  isTestnet: true,
  networkID,
  infura: "",
  etherscan: "",
  addresses: {
    GatewayRegistry: gatewayRegistry,
    BasicAdapter: basicAdapter,
  },
});
