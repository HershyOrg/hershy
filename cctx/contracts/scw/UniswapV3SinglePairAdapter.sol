// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IUniswapV3SwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/// @title UniswapV3SinglePairAdapter
/// @notice MVP strategy adapter that constrains a Safe/SCW to one Uniswap V3
///         compatible quote/base pair and three actions: open, close, emergency exit.
/// @dev The SCW keeps custody. Calls are expected to arrive through a Safe module,
///      making `msg.sender` the SCW. The SCW must approve this adapter for the
///      relevant token before the adapter can pull funds for a swap.
contract UniswapV3SinglePairAdapter {
    address public immutable router;
    address public immutable quoteToken;
    address public immutable baseToken;
    uint24 public immutable poolFee;

    event PositionOpened(address indexed wallet, uint256 amountIn, uint256 amountOut);
    event PositionClosed(address indexed wallet, uint256 amountIn, uint256 amountOut);
    event EmergencyExited(address indexed wallet, uint256 amountIn, uint256 amountOut);

    error InvalidAddress();
    error ZeroAmount();
    error TokenCallFailed();

    constructor(address router_, address quoteToken_, address baseToken_, uint24 poolFee_) {
        if (router_ == address(0) || quoteToken_ == address(0) || baseToken_ == address(0)) {
            revert InvalidAddress();
        }
        if (quoteToken_ == baseToken_) {
            revert InvalidAddress();
        }
        router = router_;
        quoteToken = quoteToken_;
        baseToken = baseToken_;
        poolFee = poolFee_;
    }

    /// @notice Pulls quote token from the calling SCW and swaps quote -> base.
    function openPosition(uint256 amountIn, uint256 minAmountOut) external returns (uint256 amountOut) {
        amountOut = _swapFromWallet(quoteToken, baseToken, amountIn, minAmountOut);
        emit PositionOpened(msg.sender, amountIn, amountOut);
    }

    /// @notice Pulls base token from the calling SCW and swaps base -> quote.
    function closePosition(uint256 amountIn, uint256 minAmountOut) external returns (uint256 amountOut) {
        amountOut = _swapFromWallet(baseToken, quoteToken, amountIn, minAmountOut);
        emit PositionClosed(msg.sender, amountIn, amountOut);
    }

    /// @notice Closes the full base-token balance currently held by the calling SCW.
    function emergencyExit(uint256 minAmountOut) external returns (uint256 amountOut) {
        uint256 amountIn = IERC20Minimal(baseToken).balanceOf(msg.sender);
        if (amountIn == 0) revert ZeroAmount();
        amountOut = _swapFromWallet(baseToken, quoteToken, amountIn, minAmountOut);
        emit EmergencyExited(msg.sender, amountIn, amountOut);
    }

    function _swapFromWallet(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) internal returns (uint256 amountOut) {
        if (amountIn == 0) revert ZeroAmount();

        _safeTransferFrom(tokenIn, msg.sender, address(this), amountIn);
        _safeApprove(tokenIn, router, amountIn);

        amountOut = IUniswapV3SwapRouter(router).exactInputSingle(
            IUniswapV3SwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: poolFee,
                recipient: msg.sender,
                amountIn: amountIn,
                amountOutMinimum: minAmountOut,
                sqrtPriceLimitX96: 0
            })
        );

        _safeApprove(tokenIn, router, 0);
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        _callOptionalBool(token, abi.encodeCall(IERC20Minimal.transferFrom, (from, to, amount)));
    }

    function _safeApprove(address token, address spender, uint256 amount) internal {
        _callOptionalBool(token, abi.encodeCall(IERC20Minimal.approve, (spender, amount)));
    }

    function _callOptionalBool(address token, bytes memory data) internal {
        (bool success, bytes memory returnData) = token.call(data);
        if (!success) revert TokenCallFailed();
        if (returnData.length > 0 && !abi.decode(returnData, (bool))) revert TokenCallFailed();
    }
}
