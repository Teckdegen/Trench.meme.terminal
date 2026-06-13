import {expect} from "chai";
import {ethers} from "hardhat";

describe("Moon or Doom duel", () => {
  async function deploy() {
    const [owner, house, alice, bob] = await ethers.getSigners();
    const registry = await (await ethers.getContractFactory("GameRegistry")).deploy(owner.address);
    const vault = await (await ethers.getContractFactory("CasinoVault")).deploy(
      await registry.getAddress(),
      house.address,
      owner.address,
    );
    const tickets = await (await ethers.getContractFactory("PositionNFT")).deploy(
      await registry.getAddress(),
    );
    const flip = await (await ethers.getContractFactory("MoonOrDoom")).deploy(
      await vault.getAddress(),
      await tickets.getAddress(),
    );
    await registry.addGame(await flip.getAddress());
    return {vault, flip, alice, bob};
  }

  // commit = keccak256(secret); secret = keccak256(label)
  const secret = (label: string) => ethers.id(label);
  const commit = (label: string) =>
    ethers.keccak256(ethers.solidityPacked(["bytes32"], [ethers.id(label)]));

  it("pays the winner the pot minus 10% rake and the house takes its cut", async () => {
    const {vault, flip, alice, bob} = await deploy();
    await flip.connect(alice).post(0, commit("alice"), {value: ethers.parseEther("10")});
    await flip.connect(bob).accept(1, 1, commit("bob"), {value: ethers.parseEther("10")});
    await flip.connect(alice).reveal(1, secret("alice"));
    await flip.connect(bob).reveal(1, secret("bob")); // settles
    const total = (await vault.claimableOf(alice.address)) + (await vault.claimableOf(bob.address));
    expect(total).to.equal(ethers.parseEther("18"));
    expect(await vault.houseAccrued()).to.equal(ethers.parseEther("2"));
  });

  it("refunds an unmatched challenge with no rake", async () => {
    const {vault, flip, alice} = await deploy();
    await flip.connect(alice).post(0, commit("alice"), {value: ethers.parseEther("7")});
    await ethers.provider.send("evm_increaseTime", [11 * 60]);
    await ethers.provider.send("evm_mine", []);
    await flip.expire(1);
    expect(await vault.claimableOf(alice.address)).to.equal(ethers.parseEther("7"));
    expect(await vault.houseAccrued()).to.equal(0n);
  });

  it("rejects a stake outside the 35% match band", async () => {
    const {flip, alice, bob} = await deploy();
    await flip.connect(alice).post(0, commit("alice"), {value: ethers.parseEther("10")});
    await expect(
      flip.connect(bob).accept(1, 1, commit("bob"), {value: ethers.parseEther("20")}),
    ).to.be.revertedWith("stake out of band");
  });

  it("matches unequal stakes within the band and pays pot minus rake", async () => {
    const {vault, flip, alice, bob} = await deploy();
    await flip.connect(alice).post(0, commit("alice"), {value: ethers.parseEther("10")});
    await flip.connect(bob).accept(1, 1, commit("bob"), {value: ethers.parseEther("13")});
    await flip.connect(alice).reveal(1, secret("alice"));
    await flip.connect(bob).reveal(1, secret("bob"));
    const total = (await vault.claimableOf(alice.address)) + (await vault.claimableOf(bob.address));
    expect(total).to.equal(ethers.parseEther("20.7"));
    expect(await vault.houseAccrued()).to.equal(ethers.parseEther("2.3"));
  });
});
