pragma solidity ^0.4.24;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/lifecycle/Pausable.sol";
import "openzeppelin-solidity/contracts/lifecycle/Destructible.sol";
import "openzeppelin-solidity/contracts/ownership/Contactable.sol";
import "monetha-utility-contracts/contracts/Restricted.sol";
import "./MonethaGateway.sol";
import "./MerchantWallet.sol";
import "./GenericERC20.sol";

contract PrivatePaymentProcessor is Pausable, Destructible, Contactable, Restricted {

    using SafeMath for uint256;

    string constant VERSION = "0.6";

    /**
      *  Payback permille.
      *  1 permille = 0.1 %
      */
    uint public constant PAYBACK_PERMILLE = 2; // 0.2%

    // Order paid event
    event OrderPaidInEther(
        uint indexed _orderId,
        address indexed _originAddress,
        uint _price,
        uint _monethaFee,
        uint _discount
    );

    event OrderPaidInToken(
        uint indexed _orderId,
        address indexed _originAddress,
        address indexed _tokenAddress,
        uint _price,
        uint _monethaFee
    );

    // Payments have been processed event
    event PaymentsProcessed(
        address indexed _merchantAddress,
        uint _amount,
        uint _fee
    );

    // PaymentRefunding is an event when refunding initialized
    event PaymentRefunding(
        uint indexed _orderId,
        address indexed _clientAddress,
        uint _amount,
        string _refundReason
    );

    // PaymentWithdrawn event is fired when payment is withdrawn
    event PaymentWithdrawn(
        uint indexed _orderId,
        address indexed _clientAddress,
        uint amount
    );

    /// MonethaGateway contract for payment processing
    MonethaGateway public monethaGateway;

    /// Address of MerchantWallet, where merchant reputation and funds are stored
    MerchantWallet public merchantWallet;

    /// Merchant identifier hash, that associates with the acceptor
    bytes32 public merchantIdHash;

    enum WithdrawState {Null, Pending, Withdrawn}

    struct Withdraw {
        WithdrawState state;
        uint amount;
        address clientAddress;
        address tokenAddress;
    }

    mapping(uint => Withdraw) public withdrawals;

    /**
     *  Private Payment Processor sets Monetha Gateway and Merchant Wallet.
     *  @param _merchantId Merchant of the acceptor
     *  @param _monethaGateway Address of MonethaGateway contract for payment processing
     *  @param _merchantWallet Address of MerchantWallet, where merchant reputation and funds are stored
     */
    constructor(
        string _merchantId,
        MonethaGateway _monethaGateway,
        MerchantWallet _merchantWallet
    )
    public
    {
        require(bytes(_merchantId).length > 0);

        merchantIdHash = keccak256(abi.encodePacked(_merchantId));

        setMonethaGateway(_monethaGateway);
        setMerchantWallet(_merchantWallet);
    }

    /**
     *  payForOrder is used by order wallet/client to pay for the order
     *  @param _orderId Identifier of the order
     *  @param _originAddress buyer address
     *  @param _monethaFee is fee collected by Monetha
     */
    function payForOrder(
        uint _orderId,
        address _originAddress,
        uint _monethaFee,
        uint _vouchersApply
    )
    external payable whenNotPaused
    {
        require(_orderId > 0);
        require(_originAddress != 0x0);
        require(msg.value > 0);

        address fundAddress;
        fundAddress = merchantWallet.merchantFundAddress();

        uint discountWei = 0;
        if (fundAddress != address(0)) {
            discountWei = monethaGateway.acceptPayment.value(msg.value)(
                fundAddress,
                _monethaFee,
                _originAddress,
                _vouchersApply,
                PAYBACK_PERMILLE);
        } else {
            discountWei = monethaGateway.acceptPayment.value(msg.value)(
                merchantWallet,
                _monethaFee,
                _originAddress,
                _vouchersApply,
                PAYBACK_PERMILLE);
        }

        // log payment event
        emit OrderPaidInEther(_orderId, _originAddress, msg.value, _monethaFee, discountWei);
    }

    /**
     *  payForOrderInTokens is used by order wallet/client to pay for the order
     *  This call requires that token's approve method has been called prior to this.
     *  @param _orderId Identifier of the order
     *  @param _originAddress buyer address
     *  @param _monethaFee is fee collected by Monetha
     *  @param _tokenAddress is tokens address
     *  @param _orderValue is order amount
     */
    function payForOrderInTokens(
        uint _orderId,
        address _originAddress,
        uint _monethaFee,
        address _tokenAddress,
        uint _orderValue
    )
    external whenNotPaused
    {
        require(_orderId > 0);
        require(_originAddress != 0x0);
        require(_orderValue > 0);
        require(_tokenAddress != address(0));

        address fundAddress;
        fundAddress = merchantWallet.merchantFundAddress();

        GenericERC20(_tokenAddress).transferFrom(msg.sender, address(this), _orderValue);

        GenericERC20(_tokenAddress).transfer(address(monethaGateway), _orderValue);

        if (fundAddress != address(0)) {
            monethaGateway.acceptTokenPayment(fundAddress, _monethaFee, _tokenAddress, _orderValue);
        } else {
            monethaGateway.acceptTokenPayment(merchantWallet, _monethaFee, _tokenAddress, _orderValue);
        }

        // log payment event
        emit OrderPaidInToken(_orderId, _originAddress, _tokenAddress, _orderValue, _monethaFee);
    }

    /**
     *  refundPayment used in case order cannot be processed and funds need to be returned
     *  This function initiate process of funds refunding to the client.
     *  @param _orderId Identifier of the order
     *  @param _clientAddress is an address of client
     *  @param _refundReason Order refund reason
     */
    function refundPayment(
        uint _orderId,
        address _clientAddress,
        string _refundReason
    )
    external payable onlyMonetha whenNotPaused
    {
        require(_orderId > 0);
        require(_clientAddress != 0x0);
        require(msg.value > 0);
        require(WithdrawState.Null == withdrawals[_orderId].state);

        // create withdraw
        withdrawals[_orderId] = Withdraw({
            state : WithdrawState.Pending,
            amount : msg.value,
            clientAddress : _clientAddress,
            tokenAddress: address(0)
            });

        // log refunding
        emit PaymentRefunding(_orderId, _clientAddress, msg.value, _refundReason);
    }

    /**
     *  refundTokenPayment used in case order cannot be processed and tokens need to be returned
     *  This call requires that token's approve method has been called prior to this.
     *  This function initiate process of refunding tokens to the client.
     *  @param _orderId Identifier of the order
     *  @param _clientAddress is an address of client
     *  @param _refundReason Order refund reason
     *  @param _tokenAddress is tokens address
     *  @param _orderValue is order amount
     */
    function refundTokenPayment(
        uint _orderId,
        address _clientAddress,
        string _refundReason,
        uint _orderValue,
        address _tokenAddress
    )
    external onlyMonetha whenNotPaused
    {
        require(_orderId > 0);
        require(_clientAddress != 0x0);
        require(_orderValue > 0);
        require(_tokenAddress != address(0));
        require(WithdrawState.Null == withdrawals[_orderId].state);

        GenericERC20(_tokenAddress).transferFrom(msg.sender, address(this), _orderValue);

        // create withdraw
        withdrawals[_orderId] = Withdraw({
            state : WithdrawState.Pending,
            amount : _orderValue,
            clientAddress : _clientAddress,
            tokenAddress : _tokenAddress
            });

        // log refunding
        emit PaymentRefunding(_orderId, _clientAddress, _orderValue, _refundReason);
    }

    /**
     *  withdrawRefund performs fund transfer to the client's account.
     *  @param _orderId Identifier of the order
     */
    function withdrawRefund(uint _orderId)
    external whenNotPaused
    {
        Withdraw storage withdraw = withdrawals[_orderId];
        require(WithdrawState.Pending == withdraw.state);
        require(withdraw.tokenAddress == address(0));

        address clientAddress = withdraw.clientAddress;
        uint amount = withdraw.amount;

        // changing withdraw state before transfer
        withdraw.state = WithdrawState.Withdrawn;

        // transfer fund to clients account
        clientAddress.transfer(amount);

        // log withdrawn
        emit PaymentWithdrawn(_orderId, clientAddress, amount);
    }

    /**
     *  withdrawTokenRefund performs token transfer to the client's account.
     *  @param _orderId Identifier of the order
     *  @param _tokenAddress token address
     */
    function withdrawTokenRefund(uint _orderId, address _tokenAddress)
    external whenNotPaused
    {
        require(_tokenAddress != address(0));

        Withdraw storage withdraw = withdrawals[_orderId];
        require(WithdrawState.Pending == withdraw.state);
        require(withdraw.tokenAddress == _tokenAddress);

        address clientAddress = withdraw.clientAddress;
        uint amount = withdraw.amount;

        // changing withdraw state before transfer
        withdraw.state = WithdrawState.Withdrawn;

        // transfer fund to clients account
        GenericERC20(_tokenAddress).transfer(clientAddress, amount);

        // log withdrawn
        emit PaymentWithdrawn(_orderId, clientAddress, amount);
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
}