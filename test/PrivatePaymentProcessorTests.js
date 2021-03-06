import Revert from "./helpers/VMExceptionRevert";
const {BigNumber} = require('./helpers/setup');
const PrivatePaymentProcessor = artifacts.require("PrivatePaymentProcessor")
const MonethaGateway = artifacts.require("MonethaGateway")
const MerchantWallet = artifacts.require("MerchantWallet")
const Token = artifacts.require("ERC20Mintable")

contract('PrivatePaymentProcessor', function (accounts) {

    const OWNER = accounts[0]
    const PROCESSOR = accounts[1]
    const CLIENT = accounts[2]
    let FUND_ADDRESS = accounts[3]
    const GATEWAY_2 = accounts[4]
    const UNKNOWN = accounts[5]
    const ORIGIN = accounts[6]
    const ACCEPTOR = accounts[7]
    const VAULT = accounts[8]
    const MERCHANT = accounts[9]

    const PRICE = 1000
    const FEE = 15
    const ORDER_ID = 123
    const ORDER_ID2 = 456
    const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
    const MONETHA_VOUCHER_CONTRACT = "0x0000000000000000000000000000000000000000" // TODO: replace with mock or actual contract
    const VOUCHERS_APPLY = 0

    let processor, gateway, wallet, token

    before(async () => {
        gateway = await MonethaGateway.new(VAULT, PROCESSOR, MONETHA_VOUCHER_CONTRACT)
        await gateway.transferOwnership(OWNER)

        let merchantId = "merchantId"

        wallet = await MerchantWallet.new(MERCHANT, merchantId, FUND_ADDRESS)

        processor = await PrivatePaymentProcessor.new(
            merchantId,
            gateway.address,
            wallet.address
        )

        await processor.setMonethaAddress(PROCESSOR, true)
        await processor.transferOwnership(OWNER)
        await wallet.setMonethaAddress(processor.address, true)
        await wallet.transferOwnership(OWNER)
        await gateway.setMonethaAddress(processor.address, true, { from: PROCESSOR })
        token = await Token.new()
        await token.mint(PROCESSOR, PRICE)
        await token.mint(processor.address, PRICE)
        await token.approve(processor.address, PRICE, { from: PROCESSOR })
    })

    it('should indentify processor address as Monetha address', async () => {
        const res = await processor.isMonethaAddress(PROCESSOR)
        res.should.be.true
    })


    it('should refundTokenPayment payment correctly', async () => {
        const result = await processor.refundTokenPayment(
            ORDER_ID,
            ORIGIN,
            "refundig from tests",
            PRICE,
            token.address,
            { from: PROCESSOR}
        )
        const withdrawal = await processor.withdrawals(ORDER_ID)

        new BigNumber(withdrawal[0]).should.bignumber.equal(1) // Withdraw State Pending.
        new BigNumber(withdrawal[1]).should.bignumber.equal(PRICE) // Withdraw amount.
        withdrawal[2].should.equal(ORIGIN) // Withdraw clientAddress.
    })

    it('should not allow to withdraw ether if paid via tokens', async () => {
        await processor.withdrawRefund(ORDER_ID, { from: UNKNOWN }).should.be.rejectedWith(Revert);
    })

    it('should withdraw token refund correctly', async () => {
        var clientBalance1 = await token.balanceOf(ORIGIN)
        clientBalance1.toNumber()
        var processorBalance1 = await token.balanceOf(processor.address)
        processorBalance1.toNumber()

        await processor.withdrawTokenRefund(ORDER_ID, token.address, { from: UNKNOWN })

        var clientBalance2 = await token.balanceOf(ORIGIN)
        clientBalance2.toNumber()
        var processorBalance2 = await token.balanceOf(processor.address)
        processorBalance2.toNumber()

        var processorBalanceDiff = processorBalance2 - processorBalance1
        var clientBalanceDiff = clientBalance2 - clientBalance1
        
        processorBalanceDiff.should.equal(-PRICE)
        clientBalanceDiff.should.equal(PRICE)
    })

    it('should set Monetha gateway correctly', async () => {
        const oldGateWayAddress = await processor.monethaGateway()
        await processor.setMonethaGateway(GATEWAY_2, { from: OWNER })

        const gateway = await processor.monethaGateway()
        gateway.should.equal(GATEWAY_2)

        await processor.setMonethaGateway(oldGateWayAddress, { from: OWNER })
    })


    it('should pay for order correctly in tokens', async () => {
        await token.mint(ACCEPTOR, PRICE)
        await token.approve(processor.address, PRICE, { from: ACCEPTOR })
        FUND_ADDRESS = accounts[3]
        var FUND_ADDRESS_BALANCE = await token.balanceOf(FUND_ADDRESS)
        FUND_ADDRESS_BALANCE.toNumber()
        const monethaFee = FEE
        var vaultBalance1 = await token.balanceOf(VAULT)
        vaultBalance1.toNumber()
        
        await processor.payForOrderInTokens(ORDER_ID, ORIGIN, monethaFee, token.address, PRICE, { from: ACCEPTOR })
        
        var FUND_ADDRESS_BALANCE2 = await token.balanceOf(FUND_ADDRESS)
        FUND_ADDRESS_BALANCE2.toNumber()
        var vaultBalance2 = await token.balanceOf(VAULT)
        vaultBalance2.toNumber()
        
        var vaultBalanceDiff = vaultBalance2 - vaultBalance1
        var fundAddressDiff = FUND_ADDRESS_BALANCE2 - FUND_ADDRESS_BALANCE

        vaultBalanceDiff.should.equal(monethaFee)
        fundAddressDiff.should.equal(PRICE - monethaFee)
    })


    it('should not pay for order in Tokens when monetha fee > 1.5%', async () => {
        const monethaFee = 16
        await processor.payForOrderInTokens(ORDER_ID, ORIGIN, monethaFee, { from: ACCEPTOR, value: PRICE }).should.be.rejected
    })

    it('should not pay for order when monetha fee > 1.5%', async () => {
        const monethaFee = 16
        await processor.payForOrder(ORDER_ID, ORIGIN, monethaFee, VOUCHERS_APPLY, { from: ACCEPTOR }).should.be.rejected
    })

    it('should refund payment correctly', async () => {
        const result = await processor.refundPayment(
            ORDER_ID2,
            ORIGIN,
            "refundig from tests",
            { from: PROCESSOR, value: PRICE }
        )
        const withdrawal = await processor.withdrawals(ORDER_ID2)

        new BigNumber(withdrawal[0]).should.bignumber.equal(1) // Withdraw State Pending.
        new BigNumber(withdrawal[1]).should.bignumber.equal(PRICE) // Withdraw amount.
        withdrawal[2].should.equal(ORIGIN) // Withdraw clientAddress.
    })

    it('should not allow to withdraw tokens if paid via ether', async () => {
        await processor.withdrawTokenRefund(ORDER_ID2, ZERO_ADDRESS, { from: UNKNOWN }).should.be.rejectedWith(Revert);
    })

    it('should withdraw refund correctly', async () => {
        const clientBalance1 = new BigNumber(web3.eth.getBalance(ORIGIN))
        const processorBalance1 = new BigNumber(web3.eth.getBalance(processor.address))

        await processor.withdrawRefund(ORDER_ID2, { from: UNKNOWN })

        const clientBalance2 = new BigNumber(web3.eth.getBalance(ORIGIN))
        const processorBalance2 = new BigNumber(web3.eth.getBalance(processor.address))

        processorBalance2.minus(processorBalance1).should.bignumber.equal(-PRICE)
        clientBalance2.minus(clientBalance1).should.bignumber.equal(PRICE)
    })

    it('should set Monetha gateway correctly', async () => {
        const oldGateWayAddress = await processor.monethaGateway()
        await processor.setMonethaGateway(GATEWAY_2, { from: OWNER })

        const gateway = await processor.monethaGateway()
        gateway.should.equal(GATEWAY_2)

        await processor.setMonethaGateway(oldGateWayAddress, { from: OWNER })
    })

    it('should not allow to withdraw refund two times', async () => {
        await processor.withdrawRefund(ORDER_ID2, { from: UNKNOWN }).should.be.rejected
    })

    it('should pay for order correctly when fund address is present', async () => {
        FUND_ADDRESS = accounts[3]
        const FUND_ADDRESS_BALANCE = new BigNumber(web3.eth.getBalance(FUND_ADDRESS))
        const monethaFee = FEE
        const vaultBalance1 = new BigNumber(web3.eth.getBalance(VAULT))
        
        await processor.payForOrder(ORDER_ID2, ORIGIN, monethaFee, VOUCHERS_APPLY, { from: ACCEPTOR, value: PRICE })
        
        const FUND_ADDRESS_BALANCE2 = new BigNumber(web3.eth.getBalance(FUND_ADDRESS))
        const vaultBalance2 = new BigNumber(web3.eth.getBalance(VAULT))
        
        vaultBalance2.minus(vaultBalance1).should.bignumber.equal(monethaFee)
        FUND_ADDRESS_BALANCE2.minus(FUND_ADDRESS_BALANCE).should.bignumber.equal(PRICE - monethaFee)
    })
    
    it('should pay for order correctly when fund address is not present', async () => {
        FUND_ADDRESS = "0x0000000000000000000000000000000000000000"
        gateway = await MonethaGateway.new(VAULT, PROCESSOR, MONETHA_VOUCHER_CONTRACT)
        await gateway.transferOwnership(OWNER)

        const merchantId = "merchantId"

        wallet = await MerchantWallet.new(MERCHANT, merchantId, FUND_ADDRESS)

        processor = await PrivatePaymentProcessor.new(
            merchantId,
            gateway.address,
            wallet.address
        )

        await processor.setMonethaAddress(PROCESSOR, true)
        await processor.transferOwnership(OWNER)
        await wallet.setMonethaAddress(processor.address, true)
        await wallet.transferOwnership(OWNER)
        await gateway.setMonethaAddress(processor.address, true, { from: PROCESSOR })


        const monethaFee = FEE
        const vaultBalance1 = new BigNumber(web3.eth.getBalance(VAULT))

        await processor.payForOrder(ORDER_ID2, ORIGIN, monethaFee, VOUCHERS_APPLY, { from: ACCEPTOR, value: PRICE })

        const vaultBalance2 = new BigNumber(web3.eth.getBalance(VAULT))
        const merchantBalance = new BigNumber(web3.eth.getBalance(wallet.address))

        vaultBalance2.minus(vaultBalance1).should.bignumber.equal(monethaFee)
        merchantBalance.should.bignumber.equal(PRICE - monethaFee)
    })

    it('should not pay for order when price is 0', async () => {
        const monethaFee = 0
        await processor.payForOrder(ORDER_ID2, ORIGIN, monethaFee, VOUCHERS_APPLY, { from: ACCEPTOR, value: 0 }).should.be.rejected
    })

    it('should not pay for order when order id is 0', async () => {
        const monethaFee = FEE
        await processor.payForOrder(0, ORIGIN, monethaFee, VOUCHERS_APPLY, { from: ACCEPTOR, value: PRICE }).should.be.rejected
    })
})
