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

  // ── Degen classics (Wave 8), all PvP ──────────────────────────────────
  const alphaCall = await (await ethers.getContractFactory("AlphaCall")).deploy(vaultAddr, ticketsAddr);
  const diamondHands = await (await ethers.getContractFactory("DiamondHands")).deploy(vaultAddr, ticketsAddr);
  const chamber = await (await ethers.getContractFactory("Chamber")).deploy(vaultAddr, ticketsAddr);
  const knifeCatcher = await (await ethers.getContractFactory("KnifeCatcher")).deploy(vaultAddr, ticketsAddr);
  const exitScam = await (await ethers.getContractFactory("ExitScam")).deploy(vaultAddr, ticketsAddr);
  const capper = await (await ethers.getContractFactory("Capper")).deploy(vaultAddr, ticketsAddr);
  const gasWar = await (await ethers.getContractFactory("GasWar")).deploy(
    vaultAddr, ticketsAddr, ethers.parseEther("50"), // MAX_BID
  );
  const whaleThrone = await (await ethers.getContractFactory("WhaleThrone")).deploy(
    vaultAddr, ticketsAddr, ethers.parseEther("1"), // base seize price
  );

  const games = [
    coinflip, dice, roulette, upDown,
    alphaCall, diamondHands, chamber, knifeCatcher, exitScam, capper, gasWar, whaleThrone,
  ];
  for (const c of games) await c.waitForDeployment();
  for (const c of games) await (await registry.addGame(await c.getAddress())).wait();

  console.log({
    registry: await registry.getAddress(),
    vault: vaultAddr,
    tickets: ticketsAddr,
    coinflip: await coinflip.getAddress(),
    dice: await dice.getAddress(),
    roulette: await roulette.getAddress(),
    upDown: await upDown.getAddress(),
    alphaCall: await alphaCall.getAddress(),
    diamondHands: await diamondHands.getAddress(),
    chamber: await chamber.getAddress(),
    knifeCatcher: await knifeCatcher.getAddress(),
    exitScam: await exitScam.getAddress(),
    capper: await capper.getAddress(),
    gasWar: await gasWar.getAddress(),
    whaleThrone: await whaleThrone.getAddress(),
  });
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
