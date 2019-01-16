pragma solidity ^0.4.24;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/lifecycle/Pausable.sol";
import "openzeppelin-solidity/contracts/lifecycle/Destructible.sol";
import "openzeppelin-solidity/contracts/ownership/Contactable.sol";
import "monetha-utility-contracts/contracts/Restricted.sol";
import "./MonethaGateway.sol";
import "./MerchantDealsHistory.sol";
import "./MerchantWallet.sol";
import "./GenericERC20.sol";


/**
 *  @title PaymentProcessor
 *  Each Merchant has one PaymentProcessor that ensure payment and order processing with Trust and Reputation
 *
 *  Payment Processor State Transitions:
 *  Null -(addOrder) -> Created
 *  Created -(securePay) -> Paid
 *  Created -(cancelOrder) -> Cancelled
 *  Paid -(refundPayment) -> Refunding
 *  Paid -(processPayment) -> Finalized
 *  Refunding -(withdrawRefund) -> Refunded
 */


contract PaymentProcessor is Pausable, Destructible, Contactable, Restricted {

    using SafeMath for uint256;

    string constant VERSION = "0.7";

    /**
     *  Fee permille of Monetha fee.
     *  1 permille = 0.1 %
     *  15 permille = 1.5%
     */
    uint public constant FEE_PERMILLE = 15;

    /**
     *  Payback permille.
     *  1 permille = 0.1 %
     */
    uint public constant PAYBACK_PERMILLE = 2; // 0.2%

    uint public constant PERMILLE_COEFFICIENT = 1000;

    /// MonethaGateway contract for payment processing
    MonethaGateway public monethaGateway;

    /// MerchantDealsHistory contract of acceptor's merchant
    MerchantDealsHistory public merchantHistory;

    /// Address of MerchantWallet, where merchant reputation and funds are stored
    MerchantWallet public merchantWallet;

    /// Merchant identifier hash, that associates with the acceptor
    bytes32 public merchantIdHash;

    enum State {Null, Created, Paid, Finalized, Refunding, Refunded, Cancelled}

    struct Order {
        State state;
        uint price;
        uint fee;
        address paymentAcceptor;
        address originAddress;
        address tokenAddress;
        uint vouchersApply;
        uint discount;
    }

    mapping(uint => Order) public orders;

    /**
     *  Asserts current state.
     *  @param _state Expected state
     *  @param _orderId Order Id
     */
    modifier atState(uint _orderId, State _state) {
        require(_state == orders[_orderId].state);
        _;
    }

    /**
     *  Performs a transition after function execution.
     *  @param _state Next state
     *  @param _orderId Order Id
     */
    modifier transition(uint _orderId, State _state) {
        _;
        orders[_orderId].state = _state;
    }

    /**
     *  payment Processor sets Monetha Gateway
     *  @param _merchantId Merchant of the acceptor
     *  @param _merchantHistory Address of MerchantDealsHistory contract of acceptor's merchant
     *  @param _monethaGateway Address of MonethaGateway contract for payment processing
     *  @param _merchantWallet Address of MerchantWallet, where merchant reputation and funds are stored
     */
    constructor(
        string _merchantId,
        MerchantDealsHistory _merchantHistory,
        MonethaGateway _monethaGateway,
        MerchantWallet _merchantWallet
    )
    public
    {
        require(bytes(_merchantId).length > 0);

        merchantIdHash = keccak256(abi.encodePacked(_merchantId));

        setMonethaGateway(_monethaGateway);
        setMerchantWallet(_merchantWallet);
        setMerchantDealsHistory(_merchantHistory);
    }

    /**
     *  Assigns the acceptor to the order (when client initiates order).
     *  @param _orderId Identifier of the order
     *  @param _price Price of the order 
     *  @param _paymentAcceptor order payment acceptor
     *  @param _originAddress buyer address
     *  @param _fee Monetha fee
     */
    function addOrder(
        uint _orderId,
        uint _price,
        address _paymentAcceptor,
        address _originAddress,
        uint _fee,
        address _tokenAddress,
        uint _vouchersApply
    ) external whenNotPaused atState(_orderId, State.Null)
    {
        require(_orderId > 0);
        require(_price > 0);
        require(_fee >= 0 && _fee <= FEE_PERMILLE.mul(_price).div(PERMILLE_COEFFICIENT));
        // Monetha fee cannot be greater than 1.5% of price
        require(_paymentAcceptor != address(0));
        require(_originAddress != address(0));
        require(orders[_orderId].price == 0 && orders[_orderId].fee == 0);

        orders[_orderId] = Order({
            state : State.Created,
            price : _price,
            fee : _fee,
            paymentAcceptor : _paymentAcceptor,
            originAddress : _originAddress,
            tokenAddress : _tokenAddress,
            vouchersApply : _vouchersApply,
            discount: 0
            });
    }

    /**
     *  securePay can be used by client if he wants to securely set client address for refund together with payment.
     *  This function require more gas, then fallback function.
     *  @param _orderId Identifier of the order
     */
    function securePay(uint _orderId)
    external payable whenNotPaused
    atState(_orderId, State.Created) transition(_orderId, State.Paid)
    {
        Order storage order = orders[_orderId];

        require(order.tokenAddress == address(0));
        require(msg.sender == order.paymentAcceptor);
        require(msg.value == order.price);
    }

    /**
     *  secureTokenPay can be used by client if he wants to securely set client address for token refund together with token payment.
     *  This call requires that token's approve method has been called prior to this.
     *  @param _orderId Identifier of the order
     */
    function secureTokenPay(uint _orderId)
    external whenNotPaused
    atState(_orderId, State.Created) transition(_orderId, State.Paid)
    {
        Order storage order = orders[_orderId];

        require(msg.sender == order.paymentAcceptor);
        require(order.tokenAddress != address(0));

        GenericERC20(order.tokenAddress).transferFrom(msg.sender, address(this), order.price);
    }

    /**
     *  cancelOrder is used when client doesn't pay and order need to be cancelled.
     *  @param _orderId Identifier of the order
     *  @param _clientReputation Updated reputation of the client
     *  @param _merchantReputation Updated reputation of the merchant
     *  @param _dealHash Hashcode of the deal, describing the order (used for deal verification)
     *  @param _cancelReason Order cancel reason
     */
    function cancelOrder(
        uint _orderId,
        uint32 _clientReputation,
        uint32 _merchantReputation,
        uint _dealHash,
        string _cancelReason
    )
    external onlyMonetha whenNotPaused
    atState(_orderId, State.Created) transition(_orderId, State.Cancelled)
    {
        require(bytes(_cancelReason).length > 0);

        Order storage order = orders[_orderId];

        updateDealConditions(
            _orderId,
            _clientReputation,
            _merchantReputation,
            false,
            _dealHash
        );

        merchantHistory.recordDealCancelReason(
            _orderId,
            order.originAddress,
            _clientReputation,
            _merchantReputation,
            _dealHash,
            _cancelReason
        );
    }

    /**
     *  refundPayment used in case order cannot be processed.
     *  This function initiate process of funds refunding to the client.
     *  @param _orderId Identifier of the order
     *  @param _clientReputation Updated reputation of the client
     *  @param _merchantReputation Updated reputation of the merchant
     *  @param _dealHash Hashcode of the deal, describing the order (used for deal verification)
     *  @param _refundReason Order refund reason, order will be moved to State Cancelled after Client withdraws money
     */
    function refundPayment(
        uint _orderId,
        uint32 _clientReputation,
        uint32 _merchantReputation,
        uint _dealHash,
        string _refundReason
    )
    external onlyMonetha whenNotPaused
    atState(_orderId, State.Paid) transition(_orderId, State.Refunding)
    {
        require(bytes(_refundReason).length > 0);

        Order storage order = orders[_orderId];

        updateDealConditions(
            _orderId,
            _clientReputation,
            _merchantReputation,
            false,
            _dealHash
        );

        merchantHistory.recordDealRefundReason(
            _orderId,
            order.originAddress,
            _clientReputation,
            _merchantReputation,
            _dealHash,
            _refundReason
        );
    }

    /**
     *  withdrawRefund performs fund transfer to the client's account.
     *  @param _orderId Identifier of the order
     */
    function withdrawRefund(uint _orderId)
    external whenNotPaused
    atState(_orderId, State.Refunding) transition(_orderId, State.Refunded)
    {
        Order storage order = orders[_orderId];
        require(order.tokenAddress == address(0));

        order.originAddress.transfer(order.price.sub(order.discount));
    }

    /**
     *  withdrawTokenRefund performs token transfer to the client's account.
     *  @param _orderId Identifier of the order
     */
    function withdrawTokenRefund(uint _orderId)
    external whenNotPaused
    atState(_orderId, State.Refunding) transition(_orderId, State.Refunded)
    {
        require(orders[_orderId].tokenAddress != address(0));

        GenericERC20(orders[_orderId].tokenAddress).transfer(orders[_orderId].originAddress, orders[_orderId].price);
    }

    /**
     *  processPayment transfer funds/tokens to MonethaGateway and completes the order.
     *  @param _orderId Identifier of the order
     *  @param _clientReputation Updated reputation of the client
     *  @param _merchantReputation Updated reputation of the merchant
     *  @param _dealHash Hashcode of the deal, describing the order (used for deal verification)
     */
    function processPayment(
        uint _orderId,
        uint32 _clientReputation,
        uint32 _merchantReputation,
        uint _dealHash
    )
    external onlyMonetha whenNotPaused
    atState(_orderId, State.Paid) transition(_orderId, State.Finalized)
    {
        Order storage order = orders[_orderId];
        address fundAddress = merchantWallet.merchantFundAddress();

        if (order.tokenAddress != address(0)) {
            if (fundAddress != address(0)) {
                GenericERC20(order.tokenAddress).transfer(address(monethaGateway), order.price);
                monethaGateway.acceptTokenPayment(fundAddress, order.fee, order.tokenAddress, order.price);
            } else {
                GenericERC20(order.tokenAddress).transfer(address(monethaGateway), order.price);
                monethaGateway.acceptTokenPayment(merchantWallet, order.fee, order.tokenAddress, order.price);
            }
        } else {
            uint discountWei = 0;
            if (fundAddress != address(0)) {
                discountWei = monethaGateway.acceptPayment.value(order.price)(
                    fundAddress,
                    order.fee,
                    order.originAddress,
                    order.vouchersApply,
                    PAYBACK_PERMILLE);
            } else {
                discountWei = monethaGateway.acceptPayment.value(order.price)(
                    merchantWallet,
                    order.fee,
                    order.originAddress,
                    order.vouchersApply,
                    PAYBACK_PERMILLE);
            }

            if (discountWei > 0) {
                order.discount = discountWei;
            }
        }

        updateDealConditions(
            _orderId,
            _clientReputation,
            _merchantReputation,
            true,
            _dealHash
        );
    }

    /**
     *  setMonethaGateway allows owner to change address of MonethaGateway.
     *  @param _newGateway Address of new MonethaGateway contract
     */
    function setMonethaGateway(MonethaGateway _newGateway) public onlyOwner {
        require(address(_newGateway) != 0x0);

        monethaGateway = _newGateway;
    }

    /**
     *  setMerchantWallet allows owner to change address of MerchantWallet.
     *  @param _newWallet Address of new MerchantWallet contract
     */
    function setMerchantWallet(MerchantWallet _newWallet) public onlyOwner {
        require(address(_newWallet) != 0x0);
        require(_newWallet.merchantIdHash() == merchantIdHash);

        merchantWallet = _newWallet;
    }

    /**
     *  setMerchantDealsHistory allows owner to change address of MerchantDealsHistory.
     *  @param _merchantHistory Address of new MerchantDealsHistory contract
     */
    function setMerchantDealsHistory(MerchantDealsHistory _merchantHistory) public onlyOwner {
        require(address(_merchantHistory) != 0x0);
        require(_merchantHistory.merchantIdHash() == merchantIdHash);

        merchantHistory = _merchantHistory;
    }

    /**
     *  updateDealConditions record finalized deal and updates merchant reputation
     *  in future: update Client reputation
     *  @param _orderId Identifier of the order
     *  @param _clientReputation Updated reputation of the client
     *  @param _merchantReputation Updated reputation of the merchant
     *  @param _isSuccess Identifies whether deal was successful or not
     *  @param _dealHash Hashcode of the deal, describing the order (used for deal verification)
     */
    function updateDealConditions(
        uint _orderId,
        uint32 _clientReputation,
        uint32 _merchantReputation,
        bool _isSuccess,
        uint _dealHash
    )
    internal
    {
        merchantHistory.recordDeal(
            _orderId,
            orders[_orderId].originAddress,
            _clientReputation,
            _merchantReputation,
            _isSuccess,
            _dealHash
        );

        //update parties Reputation
        merchantWallet.setCompositeReputation("total", _merchantReputation);
    }
}
