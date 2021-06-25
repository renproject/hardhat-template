import { ethers } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { Adapter__factory, GatewayFactory__factory, BasicAdapter__factory } from "../typechain";
import BigNumber from "bignumber.js";

// RenJS imports
import { MockProvider, MockChain } from "@renproject/mock-provider";
import RenJS from "@renproject/ren";
import { RenVMProvider } from "@renproject/rpc/build/main/v2";
import { Ethereum, EthereumConfig } from "@renproject/chains-ethereum";
import { Ox } from "@renproject/utils";

chai.use(solidity);
const { expect } = chai;

describe("Token", () => {
  let adapterAddress: string;
  let gatewayRegistryAddress: string;

  let bitcoin: MockChain;
  let renJS: RenJS;
  let network: EthereumConfig;

  beforeEach(async () => {
    const [deployer, user] = await ethers.getSigners();

    const mockRenVMProvider = new MockProvider();
    renJS = new RenJS(new RenVMProvider("testnet", mockRenVMProvider));

    // Set up mock Bitcoin chain.
    bitcoin = new MockChain();
    mockRenVMProvider.registerChain(bitcoin);

    // Get mint authority from mock provider.
    const mintAuthority = mockRenVMProvider.mintAuthority();

    // Deploy Gateway Factory.
    const gatewayFactoryFactory = new GatewayFactory__factory(deployer);
    const gatewayFactory = await gatewayFactoryFactory.deploy(mintAuthority, "Ethereum");
    gatewayRegistryAddress = Ox(await await gatewayFactory.registry());

    // Deploy BTC token and gateway.
    await gatewayFactory.addToken("Bitcoin", "BTC", 8);

    // Deploy ZEC token and gateway.
    await gatewayFactory.addToken("Zcash", "ZEC", 8);

    // Deploy BasicAdapter.
    const basicAdapterFactory = new BasicAdapter__factory(deployer);
    const basicAdapter = await basicAdapterFactory.deploy(gatewayRegistryAddress);

    network = {
      name: "hardhat",
      chain: "hardhat",
      isTestnet: true,
      networkID: (await user.provider?.getNetwork())?.chainId!,
      chainLabel: "Hardhat",
      infura: "",
      etherscan: "",
      addresses: {
        GatewayRegistry: gatewayRegistryAddress,
        BasicAdapter: basicAdapter.address,
      },
    };

    // Deploy Adapter.
    const adapterFactory = new Adapter__factory(deployer);
    const adapterContract = await adapterFactory.deploy(gatewayRegistryAddress);
    adapterAddress = adapterContract.address;
  });

  describe("Mint", async () => {
    it("Should mint some tokens", async () => {
      const [_, user] = await ethers.getSigners();

      const amount = new BigNumber(0.003).times(
        new BigNumber(10).exponentiatedBy(bitcoin.assetDecimals(bitcoin.asset)),
      );

      const mint = await renJS.lockAndMint({
        // Send BTC from the Bitcoin blockchain to the Ethereum blockchain.
        asset: bitcoin.asset,
        from: bitcoin,
        // If you change this to another chain, you also have to change the
        // chain name passed to `gatewayFactory` above.
        to: Ethereum(user.provider! as any, user, network).Contract({
          // The contract we want to interact with
          sendTo: Ox(adapterAddress),

          // The name of the function we want to call
          contractFn: "deposit",

          // Arguments expected for calling `deposit`
          contractParams: [
            {
              name: "_msg",
              type: "bytes",
              value: Buffer.from(`Depositing ${amount} BTC`),
            },
          ],
        }),
      });

      // Mock deposit.
      bitcoin.addUTXO(mint.gatewayAddress!, amount.toNumber());

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
    });
  });
});
