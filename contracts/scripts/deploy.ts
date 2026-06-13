import {ethers} from "hardhat";

// Deploys the casino core + the launch-wave games + the MON Up/Down stack and
// registers every game. Poker is deployed separately (it needs a dealer +,
// for the zk path, the generated verifiers).
//
//   MONAD_RPC_URL, PRIVATE_KEY, FEE_WALLET, PRICE_BOT in env.
//   npm run deploy:monad
async function main() {
  const [deployer] = await ethers.getSigners();
  const owner = await deployer.getAddress();
  const feeWallet = process.env.FEE_WALLET ?? owner;
  const resolverBot = process.env.RESOLVER_BOT ?? owner; // resolves Up/Down rounds

  console.log("deployer:", owner);

  const registry = await (await ethers.getContractFactory("GameRegistry")).deploy(owner);
  await registry.waitForDeployment();

  const vault = await (await ethers.getContractFactory("CasinoVault")).deploy(
    await registry.getAddress(),
    feeWallet,
    owner,
  );
  await vault.waitForDeployment();

  const tickets = await (await ethers.getContractFactory("PositionNFT")).deploy(
    await registry.getAddress(),
  );
  await tickets.waitForDeployment();

  const vaultAddr = await vault.getAddress();
  const ticketsAddr = await tickets.getAddress();

  // ~60s betting window on Monad's 400ms blocks.
  const ROULETTE_BETTING_BLOCKS = 150;

  const coinflip = await (await ethers.getContractFactory("Coinflip")).deploy(vaultAddr, ticketsAddr);
  const dice = await (await ethers.getContractFactory("DiceDuel")).deploy(vaultAddr, ticketsAddr);
  const roulette = await (await ethers.getContractFactory("Roulette")).deploy(
    vaultAddr,
    ticketsAddr,
    ROULETTE_BETTING_BLOCKS,
  );

  // MON Up/Down: thin escrow. All matching + line math is OFFCHAIN in the bot,
  // which calls resolve(...) with the MON price after 5 min. Scales to a
  // million players per round with zero onchain matching loops.
  const upDown = await (await ethers.getContractFactory("UpDown")).deploy(
    vaultAddr,
    ticketsAddr,
    resolverBot,
    owner,
  );

  for (const c of [coinflip, dice, roulette, upDown]) await c.waitForDeployment();

  await (await registry.addGame(await coinflip.getAddress())).wait();
  await (await registry.addGame(await dice.getAddress())).wait();
  await (await registry.addGame(await roulette.getAddress())).wait();
  await (await registry.addGame(await upDown.getAddress())).wait();

  console.log({
    registry: await registry.getAddress(),
    vault: vaultAddr,
    tickets: ticketsAddr,
    coinflip: await coinflip.getAddress(),
    dice: await dice.getAddress(),
    roulette: await roulette.getAddress(),
    upDown: await upDown.getAddress(),
  });
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
