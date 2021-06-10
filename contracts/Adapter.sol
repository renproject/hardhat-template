//SPDX-License-Identifier: MIT  
pragma solidity ^0.8.0;

import "hardhat/console.sol";
import {
    IGatewayRegistry
} from "@renproject/gateway-sol/contracts/Gateway/interfaces/IGatewayRegistry.sol";

contract Adapter {
    IGatewayRegistry public registry;

    event Deposit(uint256 _amount, bytes _msg);
    event Withdrawal(bytes _to, uint256 _amount, bytes _msg);

    constructor(IGatewayRegistry _registry) {
        registry = _registry;
    }

    function deposit(
        // Parameters from users
        bytes calldata _msg,
        // Parameters from Darknodes
        uint256 _amount,
        bytes32 _nHash,
        bytes calldata _sig
    ) external {
        bytes32 pHash = keccak256(abi.encode(_msg));
        uint256 mintAmount =
            registry.getGatewayBySymbol("BTC").mint(
                pHash,
                _amount,
                _nHash,
                _sig
            );
        emit Deposit(mintAmount, _msg);
    }

    function withdraw(
        bytes calldata _msg,
        bytes calldata _to,
        uint256 _amount
    ) external {
        uint256 shiftedOutAmount =
            registry.getGatewayBySymbol("BTC").burn(_to, _amount);
        emit Withdrawal(_to, shiftedOutAmount, _msg);
    }

    function balance() public view returns (uint256) {
        return registry.getTokenBySymbol("BTC").balanceOf(address(this));
    }
}
