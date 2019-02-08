import Revert from "./helpers/VMExceptionRevert";
const {BigNumber} = require('./helpers/setup');
const PaymentProcessor = artifacts.require("DecentralisedPaymentProcessor")
const MerchantDealsHistory = artifacts.require("MerchantDealsHistory")
const MonethaGateway = artifacts.require("MonethaGateway")
const MerchantWallet = artifacts.require("MerchantWallet")
const Token = artifacts.require("ERC20Mintable")
const MonethaSupportedTokens = artifacts.require("MonethaSupportedTokens");
let merchantId;

contract('DecentralisedPaymentProcessor', function (accounts) {

    const State = {
        Null: 0,
        Created: 1,
        Paid: 2,
        Finalized: 3,
        Refunding: 4,
        Refunded: 5,
        Cancelled: 6
    }

    const OWNER = accounts[0]
    const PROCESSOR = accounts[1]
    const CLIENT = accounts[2]
    const ADMIN = accounts[3]
    const GATEWAY_2 = accounts[4]
    const UNKNOWN = accounts[5]
    const ORIGIN = accounts[6]
    const ACCEPTOR = accounts[7]
    const VAULT = accounts[8]
    const MERCHANT = accounts[9]
    const FUND_ADDRESS = accounts[2]
    var TOKEN_ADDRESS = "0x0000000000000000000000000000000000000000"
    const PRICE = 1000
    const FEE = 15
    const ORDER_ID = 123
    const ORDER_ID2 = 456
    const ORDER_ID3 = 789
    const MONETHA_VOUCHER_CONTRACT = "0x0000000000000000000000000000000000000000" // TODO: replace with mock or actual contract
    const VOUCHERS_APPLY = 0

    let processor, gateway, wallet, history, token, supportedToken

    before(async () => {
        gateway = await MonethaGateway.new(VAULT, ADMIN, MONETHA_VOUCHER_CONTRACT)
        wallet = await MerchantWallet.new(MERCHANT, "merchantId", FUND_ADDRESS)
        history = await MerchantDealsHistory.new("merchantId")
        supportedToken = await MonethaSupportedTokens.new()
        await supportedToken.setMonethaAddress(ADMIN, true)

        processor = await PaymentProcessor.new(
            supportedToken.address,
            "merchantId",
            history.address,
            gateway.address,
            wallet.address
        )

        await gateway.setMonethaAddress(processor.address, true, { from: ADMIN })
        await wallet.setMonethaAddress(processor.address, true)
        await history.setMonethaAddress(processor.address, true)
        token = await Token.new()
        await token.mint(ACCEPTOR, PRICE)
        await token.approve(processor.address, PRICE, { from: ACCEPTOR })

        await supportedToken.addToken("abc", token.address,{from: ADMIN})
    })

    it('should set Monetha address correctly', async () => {
        await processor.setMonethaAddress(PROCESSOR, true, { from: OWNER })

        const res = await processor.isMonethaAddress(PROCESSOR)
        res.should.be.true
    })


    it('should accept secure token payment correctly', async () => {
        await processor.addOrder(ORDER_ID, PRICE, ACCEPTOR, ORIGIN, token.address, VOUCHERS_APPLY, { from: PROCESSOR })
        var order = await processor.orders(ORDER_ID)
        await processor.secureTokenPay(ORDER_ID, { from: ACCEPTOR })
        
        var balance =  await token.balanceOf(processor.address)
        balance.toNumber().should.equal(PRICE)

        await checkState(processor, ORDER_ID, State.Paid)
    })

    it('should refund payment correctly for tokens', async () => {
        const clientReputation = randomReputation()
        const merchantReputation = randomReputation()

        const result = await processor.refundPayment(
            ORDER_ID,
            clientReputation,
            merchantReputation,
            0x1234,
            "refundig from tests",
            { from: PROCESSOR }
        )

        await checkReputation(
            wallet,
            clientReputation,
            merchantReputation
        )
        await checkState(processor, ORDER_ID, State.Refunding)

        const order = await processor.orders(ORDER_ID)
    })

    it('should not allow to withdraw ether if paid via tokens', async () => {
        await processor.withdrawRefund(ORDER_ID, { from: UNKNOWN }).should.be.rejectedWith(Revert);
    })

    it('should withdraw token refund correctly', async () => {
        var clientBalance1 = await token.balanceOf(ORIGIN)
        clientBalance1.toNumber()
        var processorBalance1 = await token.balanceOf(processor.address)
        processorBalance1.toNumber()

        await processor.withdrawTokenRefund(ORDER_ID, { from: UNKNOWN })

        var clientBalance2 = await token.balanceOf(ORIGIN)
        clientBalance2.toNumber()
        var processorBalance2 = await token.balanceOf(processor.address)
        processorBalance2.toNumber()

        var processorBalanceDiff = processorBalance2 - processorBalance1
        var clientBalanceDiff = clientBalance2 - clientBalance1

        processorBalanceDiff.should.equal(-PRICE)
        clientBalanceDiff.should.equal(PRICE)

        await checkState(processor, ORDER_ID, State.Refunded)
    })

    it('should add order correctly', async () => {
        await processor.addOrder(ORDER_ID2, PRICE, ACCEPTOR, ORIGIN, TOKEN_ADDRESS, VOUCHERS_APPLY, { from: PROCESSOR })

        const order = await processor.orders(ORDER_ID2)
        new BigNumber(order[0]).should.bignumber.equal(State.Created)
        new BigNumber(order[1]).should.bignumber.equal(PRICE)
        order[3].should.equal(ACCEPTOR)
        order[4].should.equal(ORIGIN)
    })

    it("should not add order if the token is not supported", async function () {
        await processor.addOrder(ORDER_ID2, PRICE, ACCEPTOR, ORIGIN, CLIENT, VOUCHERS_APPLY, { from: PROCESSOR }).should.be.rejectedWith(Revert);
    });

    it('should not accept secure payment if token address is present', async () => {
        await processor.addOrder(ORDER_ID3, PRICE, ACCEPTOR, ORIGIN, token.address, VOUCHERS_APPLY, { from: PROCESSOR })

        const order = await processor.orders(ORDER_ID3)
        await processor.securePay(ORDER_ID3, { from: ACCEPTOR, value: PRICE }).should.be.rejectedWith(Revert);
    })

    it('should accept secure payment correctly', async () => {
        const order = await processor.orders(ORDER_ID2)

        await processor.securePay(ORDER_ID2, { from: ACCEPTOR, value: PRICE })

        const balance = new BigNumber(web3.eth.getBalance(processor.address))
        balance.should.bignumber.equal(PRICE)

        await checkState(processor, ORDER_ID2, State.Paid)
    })

    it('should refund payment correctly', async () => {
        const clientReputation = randomReputation()
        const merchantReputation = randomReputation()

        const result = await processor.refundPayment(
            ORDER_ID2,
            clientReputation,
            merchantReputation,
            0x1234,
            "refundig from tests",
            { from: PROCESSOR }
        )

        await checkReputation(
            wallet,
            clientReputation,
            merchantReputation
        )
        await checkState(processor, ORDER_ID2, State.Refunding)

        const order = await processor.orders(ORDER_ID2)
    })

    it('should not allow to withdraw tokens if paid via ether', async () => {
        await processor.withdrawTokenRefund(ORDER_ID2, { from: UNKNOWN }).should.be.rejectedWith(Revert);
    })

    it('should withdraw refund correctly', async () => {
        const clientBalance1 = new BigNumber(web3.eth.getBalance(ORIGIN))
        const processorBalance1 = new BigNumber(web3.eth.getBalance(processor.address))

        await processor.withdrawRefund(ORDER_ID2, { from: UNKNOWN })

        const clientBalance2 = new BigNumber(web3.eth.getBalance(ORIGIN))
        const processorBalance2 = new BigNumber(web3.eth.getBalance(processor.address))

        processorBalance2.minus(processorBalance1).should.bignumber.equal(-PRICE)
        clientBalance2.minus(clientBalance1).should.bignumber.equal(PRICE)

        await checkState(processor, ORDER_ID2, State.Refunded)
    })

    it('should set Monetha gateway correctly', async () => {
        await processor.setMonethaGateway(GATEWAY_2, { from: OWNER })

        const gateway = await processor.monethaGateway()
        gateway.should.equal(GATEWAY_2)
    })

    it('should cancel order correctly', async () => {
        const contracts = await setupNewWithOrder()

        await contracts.processor.cancelOrder(ORDER_ID, 1234, 1234, 0, "cancel from test", { from: PROCESSOR })

        const order = await contracts.processor.orders(ORDER_ID)
        await checkState(contracts.processor, ORDER_ID, State.Cancelled)
    })

    it('should not allow to send invalid amount of money', () => {
        return setupNewWithOrder()
            .then(a => a.processor.securePay(ORDER_ID, { from: ACCEPTOR, value: PRICE - 1 }))
            .should.be.rejected
    })

    it('should not allow to pay twice', async () => {
        const contracts = await setupNewWithOrder()
        await contracts.processor.securePay(ORDER_ID, { from: ACCEPTOR, value: PRICE })
        const res = contracts.processor.securePay(ORDER_ID, { from: ACCEPTOR, value: PRICE })

        return res.should.be.rejected
    })

    it('should process payment correctly', async () => {
        const clientReputation = randomReputation()
        const merchantReputation = randomReputation()

        const created = await setupNewWithOrder()
        const processor = created.processor

        await processor.securePay(ORDER_ID, { from: ACCEPTOR, value: PRICE })

        const processorBalance1 = new BigNumber(web3.eth.getBalance(processor.address))
        
        const result = await processor.processPayment(
            ORDER_ID,
            clientReputation,
            merchantReputation,
            0x1234,
            { from: PROCESSOR }
        )

        const processorBalance2 = new BigNumber(web3.eth.getBalance(processor.address))
        processorBalance1.minus(processorBalance2).should.bignumber.equal(PRICE)

        await checkReputation(
            created.wallet,
            clientReputation,
            merchantReputation
        )
        await checkState(processor, ORDER_ID, State.Finalized)
    })

    it('should set Merchant Deals History correctly', async () => {
        history = await MerchantDealsHistory.new("merchantId")
        const created = await setupNewWithOrder()

        await created.processor.setMerchantDealsHistory(history.address, { from: OWNER })

        const historyAddress = await created.processor.merchantHistory()
        historyAddress.should.equal(history.address)
    })

    it('should not set Merchant Deals History for different merchant id', async () => {
        const history2 = await MerchantDealsHistory.new("merchant2")

        const created = await setupNewWithOrder("merchant1")

        await created.processor.setMerchantDealsHistory(history2.address, { from: OWNER }).should.be.rejected
    })

    it('should not add order when contract is paused', async () => {
        const ORDER_ID = randomReputation()
        
        await processor.pause({ from: OWNER })

        await processor.addOrder(ORDER_ID, PRICE, ACCEPTOR, ORIGIN, TOKEN_ADDRESS, VOUCHERS_APPLY, { from: PROCESSOR }).should.be.rejected
    })

    async function checkState(processor, orderID, expected) {
        const order = await processor.orders(orderID)
        new BigNumber(order[0]).should.bignumber.equal(expected)
    }

    async function checkReputation(
        merchantWallet,
        expectedClientReputation,
        expectedMerchantReputation
    ) {
        //TODO: add client reputation check, once client wallet will be implemented

        const merchRep = new BigNumber(await merchantWallet.compositeReputation("total"))
        merchRep.should.bignumber.equal(expectedMerchantReputation)
    }


    async function setupNewWithOrder(_merchantId) {
        merchantId = _merchantId || "merchantId";
        let gateway = await MonethaGateway.new(VAULT, ADMIN, MONETHA_VOUCHER_CONTRACT)
        let wallet = await MerchantWallet.new(MERCHANT, merchantId, FUND_ADDRESS)
        let history = await MerchantDealsHistory.new(merchantId)
        let supportedToken = await MonethaSupportedTokens.new()
        await supportedToken.setMonethaAddress(ADMIN, true)

        let processor = await PaymentProcessor.new(
            supportedToken.address,
            merchantId,
            history.address,
            gateway.address,
            wallet.address
        )

        await processor.setMonethaAddress(PROCESSOR, true)
        await gateway.setMonethaAddress(processor.address, true, { from: ADMIN })
        await wallet.setMonethaAddress(processor.address, true)
        await history.setMonethaAddress(processor.address, true)
        await supportedToken.addToken("abc", token.address,{from: ADMIN})
        await processor.addOrder(ORDER_ID, PRICE, ACCEPTOR, ORIGIN, TOKEN_ADDRESS, VOUCHERS_APPLY, { from: PROCESSOR })

        return { processor, wallet }
    }

    function randomReputation() {
        return Math.floor(Math.random() * 100)
    }

})
