//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "hardhat/console.sol";
import { IGatewayRegistry } from "@renproject/gateway-sol/src/GatewayRegistry/interfaces/IGatewayRegistry.sol";

contract BridgeExample {
    IGatewayRegistry public registry;

    event Deposit(uint256 amount, bytes message);
    event Withdrawal(bytes to, uint256 amount, bytes message);

    constructor(IGatewayRegistry registry_) {
        registry = registry_;
    }

    function deposit(
        // Parameters from users
        // uint256 version,
        string calldata token,
        bytes calldata message,
        // Parameters from Darknodes
        uint256 amount,
        bytes32 nHash,
        bytes calldata signature
    ) external {
        bytes32 pHash = keccak256(abi.encode(token, message));
        uint256 mintAmount = registry.getMintGatewayBySymbol(token).mint(pHash, amount, nHash, signature);
        emit Deposit(mintAmount, message);
        console.log("Value of 'message':", string(message));
    }

    function withdraw(
        string calldata token,
        bytes calldata message,
        bytes calldata to,
        uint256 amount
    ) external {
        uint256 shiftedOutAmount = registry.getMintGatewayBySymbol(token).burn(to, amount);
        emit Withdrawal(to, shiftedOutAmount, message);
        console.log("Value of 'message':", string(message));
    }

    function balance(string calldata token) public view returns (uint256) {
        return registry.getRenAssetBySymbol(token).balanceOf(address(this));
    }
}
