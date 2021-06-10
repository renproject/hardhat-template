import { ethers } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { Adapter__factory, GatewayFactory__factory } from "../typechain";
import BN from "bn.js";
import BigNumber from "bignumber.js";

// RenJS imports
import { MockProvider, MockChain } from "@renproject/mock-provider";
import RenJS from "@renproject/ren";
import { RenVMProvider, RPCMethod } from "@renproject/rpc/build/main/v2";
import { Ethereum } from "@renproject/chains-ethereum";
import { sleep } from "@renproject/utils";

chai.use(solidity);
const { expect } = chai;

describe("Token", () => {
  let adapterAddress: string;
  let gatewayRegistry: string;

  let bitcoin: MockChain;
  let renJS: RenJS;

  beforeEach(async () => {
    const [deployer] = await ethers.getSigners();

    const mockRenVMProvider = new MockProvider();
    renJS = new RenJS(new RenVMProvider("testnet", mockRenVMProvider));

    // Set up mock Bitcoin chain.
    bitcoin = new MockChain();
    mockRenVMProvider.registerChain(bitcoin);

    const mintAuthority = mockRenVMProvider.mintAuthority();

    const gatewayFactoryFactory = new GatewayFactory__factory(deployer);
    const gatewayFactory = await gatewayFactoryFactory.deploy(mintAuthority);
    gatewayRegistry = await await gatewayFactory.registry();

    // Deploy BTC token and gateway.
    await gatewayFactory.addToken("Bitcoin", "BTC", 8);
    await gatewayFactory.addToken("Zcash", "ZEC", 8);

    const adapterFactory = new Adapter__factory(deployer);
    const adapterContract = await adapterFactory.deploy(gatewayRegistry);
    adapterAddress = adapterContract.address;
  });

  describe("Mint", async () => {
    it("Should mint some tokens", async () => {
      const [deployer, user] = await ethers.getSigners();
      const adapter = new Adapter__factory(deployer).attach(adapterAddress);

      const amount = new BigNumber(0.003).times(
        new BigNumber(10).exponentiatedBy(bitcoin.assetDecimals(bitcoin.asset)),
      );

      const mint = await renJS.lockAndMint({
        // Send BTC from the Bitcoin blockchain to the Ethereum blockchain.
        asset: bitcoin.asset,
        from: bitcoin,
        to: Ethereum(user.provider! as any).Contract({
          // The contract we want to interact with
          sendTo: adapter.address,

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

      bitcoin.addUTXO(mint.gatewayAddress!, amount.toNumber());

      await new Promise<void>(resolve => {
        mint.on("deposit", async deposit => {
          await deposit.confirmed();
          await deposit.signed();
          await deposit.mint();
          resolve();
        });
      });

      // await adapter.deposit(Buffer.from([]), 0, new BN(1).toArrayLike(Buffer, "be", 32), Buffer.from([]));
    });
  });
});
