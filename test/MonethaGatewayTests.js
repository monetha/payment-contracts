import Revert from "./helpers/VMExceptionRevert";

const {BigNumber} = require('./helpers/setup');

const MonethaGateway = artifacts.require("./MonethaGateway.sol")

const Token = artifacts.require("ERC20Mintable")

contract('MonethaGateway', function (accounts) {

    const OWNER = accounts[0]
    const VAULT = accounts[1]
    const MERCHANT = accounts[2]
    const PAYMENT_PROCESSOR_CONTRACT = accounts[3]
    const ADMIN = accounts[4]
    const CUSTOMER = accounts[5]
    const MONETHA_VOUCHER_CONTRACT = "0x0000000000000000000000000000000000000000" // TODO: replace with mock or actual contract

    let gateway
    let token

    before(async () => {
        gateway = await MonethaGateway.new(VAULT, ADMIN, MONETHA_VOUCHER_CONTRACT)
        await gateway.setMonethaAddress(PAYMENT_PROCESSOR_CONTRACT, true, {from: ADMIN})
        token = await Token.new()
        await token.mint(gateway.address, new BigNumber('1e9'))
    });

    it('should accept payment correctly', async () => {
        const value = new BigNumber('1e9')
        const feeValue = new BigNumber(await gateway.FEE_PERMILLE()).mul(value).div(1000)
        const vouchersApply = new BigNumber('0')
        const paybackPermille = new BigNumber('0')

        const merchantBalance1 = new BigNumber(web3.eth.getBalance(MERCHANT))
        const vaultBalance1 = new BigNumber(web3.eth.getBalance(VAULT))

        await gateway.acceptPayment(MERCHANT, feeValue, CUSTOMER, vouchersApply, paybackPermille, { value: value, from: PAYMENT_PROCESSOR_CONTRACT })

        const merchantBalance2 = new BigNumber(web3.eth.getBalance(MERCHANT))
        const vaultBalance2 = new BigNumber(web3.eth.getBalance(VAULT))

        const deltaMerchant = merchantBalance2.minus(merchantBalance1)
        const deltaVault = vaultBalance2.minus(vaultBalance1)
        
        deltaMerchant.should.bignumber.equal(value.sub(feeValue))
        deltaVault.should.bignumber.equal(feeValue)
    })

    it('should accept token payment correctly', async () => {
        const value = new BigNumber('1e9')
        const feeValue = new BigNumber(await gateway.FEE_PERMILLE()).mul(value).div(1000)

        const tx =  await gateway.acceptTokenPayment(
            MERCHANT,
            feeValue,
            token.address,
            value,
            {
                from: PAYMENT_PROCESSOR_CONTRACT
            }
        ).should.be.fulfilled;

        const event = tx.logs.find(e => e.event === "PaymentProcessedToken");

        event.args.merchantIncome.toNumber().should.equal(value.sub(feeValue).toNumber());
        event.args.monethaIncome.toNumber().should.be.equal(feeValue.toNumber());
    })

    it('should not accept token payment accept payment with high fee', async () => {
        const value = new BigNumber('1e9')
        const feeValue = new BigNumber(await gateway.FEE_PERMILLE()).mul(value).div(1000).add(1)

        const tx =  await gateway.acceptTokenPayment(
            MERCHANT,
            feeValue,
            token.address,
            value,
            {
                from: PAYMENT_PROCESSOR_CONTRACT
            }
        ).should.be.rejectedWith(Revert);
    })

    it('should accept payment with zero fee correctly', async () => {
        const value = new BigNumber('1e9')
        const feeValue = new BigNumber('0')
        const vouchersApply = new BigNumber('0')
        const paybackPermille = new BigNumber('0')

        const merchantBalance1 = new BigNumber(web3.eth.getBalance(MERCHANT))
        const vaultBalance1 = new BigNumber(web3.eth.getBalance(VAULT))

        await gateway.acceptPayment(MERCHANT, feeValue, CUSTOMER, vouchersApply, paybackPermille, { value: value, from: PAYMENT_PROCESSOR_CONTRACT })

        const merchantBalance2 = new BigNumber(web3.eth.getBalance(MERCHANT))
        const vaultBalance2 = new BigNumber(web3.eth.getBalance(VAULT))

        const deltaMerchant = merchantBalance2.minus(merchantBalance1)
        const deltaVault = vaultBalance2.minus(vaultBalance1)

        deltaMerchant.should.bignumber.equal(value.sub(feeValue))
        deltaVault.should.bignumber.equal(feeValue)
    })

    it('should not accept payment accept payment with high fee', async () => {
        const value = new BigNumber('1e9')
        const feeValue = new BigNumber(await gateway.FEE_PERMILLE()).mul(value).div(1000).add(1)
        const vouchersApply = new BigNumber('0')
        const paybackPermille = new BigNumber('0')

        const merchantBalance1 = new BigNumber(web3.eth.getBalance(MERCHANT))
        const vaultBalance1 = new BigNumber(web3.eth.getBalance(VAULT))

        await gateway.acceptPayment(MERCHANT, feeValue, CUSTOMER, vouchersApply, paybackPermille, { value: value, from: PAYMENT_PROCESSOR_CONTRACT }).should.be.rejectedWith(Revert);
    })

    it('should not accept payment when contract is paused', async () => {
        const value = new BigNumber('1e9')
        const feeValue = new BigNumber(await gateway.FEE_PERMILLE()).mul(value).div(1000)
        const vouchersApply = new BigNumber('0')
        const paybackPermille = new BigNumber('0')

        const merchantBalance1 = new BigNumber(web3.eth.getBalance(MERCHANT))
        const vaultBalance1 = new BigNumber(web3.eth.getBalance(VAULT))

        await gateway.pause({from:OWNER})

        await gateway.acceptPayment(MERCHANT, feeValue, CUSTOMER, vouchersApply, paybackPermille, { value: value, from: PAYMENT_PROCESSOR_CONTRACT }).should.be.rejectedWith(Revert);
    })
});
