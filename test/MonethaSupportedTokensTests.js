import { advanceBlock } from "./helpers/advanceToBlock";
import log from "./helpers/logger";
import Revert from "./helpers/VMExceptionRevert";

require('./helpers/setup');

const MonethaSupportedTokens = artifacts.require("MonethaSupportedTokens");

contract("MonethaSupportedTokens", function (accounts) {
  const token_acronym = "abc";
  const token_address = accounts[2];
  const token_address2 = accounts[3];

  let monethaSupportedToken;

  beforeEach(async function () {
    monethaSupportedToken = await MonethaSupportedTokens.new();
    await monethaSupportedToken.setMonethaAddress(accounts[0], true)

    advanceBlock();
  });

  it("should set owner address correctly", async function () {
    (await monethaSupportedToken.owner()).should.be.equal(accounts[0]);
  });

  describe("addToken", function () {
    it("should add token correctly", async function () {

      const tx = await monethaSupportedToken.addToken(
        token_acronym,
        token_address,
        {
          from: accounts[0]
        }
      ).should.be.fulfilled;

      const tokenInfo = await monethaSupportedToken.tokens(1);

      tokenInfo[1].should.be.equal(token_address);
    });

    it("should not add token by other accounts", async function () {
      await monethaSupportedToken
        .addToken(token_acronym, token_address, {
          from: accounts[1]
        })
        .should.be.rejectedWith(Revert);
    });

  });

  describe("deleteToken", function () {
    it("should delete token correctly", async function () {

      const tx = await monethaSupportedToken.addToken(
        token_acronym,
        token_address,
        {
          from: accounts[0]
        }
      ).should.be.fulfilled;

      const tokenInfo = await monethaSupportedToken.tokens(1);

      tokenInfo[1].should.be.equal(token_address);

      const tx1 = await monethaSupportedToken.addToken(
        token_acronym,
        token_address2,
        {
          from: accounts[0]
        }
      ).should.be.fulfilled;

      const tokenInfo1 = await monethaSupportedToken.tokens(2);
      tokenInfo1[1].should.be.equal(token_address2);

      const tx2 = await monethaSupportedToken.deleteToken(
       1,
        {
          from: accounts[0]
        }
      ).should.be.fulfilled;


      const tokenInfo2 = await monethaSupportedToken.tokens(1);
      const tokenInfo3 = await monethaSupportedToken.tokens(2);

      tokenInfo2[1].should.be.equal(token_address2);
      tokenInfo3[1].should.be.equal("0x0000000000000000000000000000000000000000");

    });

    it("should not delete token by other accounts", async function () {
      await monethaSupportedToken
        .deleteToken(1, {
          from: accounts[1]
        })
        .should.be.rejectedWith(Revert);
    });

  });

  describe("getAll", function () {
    it("should get all tokens info correctly", async function () {

      const tx = await monethaSupportedToken.addToken(
          token_acronym,
          token_address,
          {
            from: accounts[0]
          }
        ).should.be.fulfilled;
  
      const tx1 = await monethaSupportedToken.getAll.call();

      tx1[0][0].should.be.equal(token_address);
    });

  });

  
});
