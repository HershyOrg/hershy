// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

interface ISafeModuleExecutor {
    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation
    ) external returns (bool success);
}

/// @title StrategyPolicyModule
/// @notice Safe-compatible module that grants per-session-key execution rights
///         and verifies SCW relay requests with EIP-712 before forwarding them
///         through `execTransactionFromModule`.
contract StrategyPolicyModule {
    string public constant EIP712_NAME = "HershyStrategyPolicy";
    string public constant EIP712_VERSION = "1";

    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant SCW_EXECUTION_TYPEHASH =
        keccak256(
            "SCWExecution(address contractAddress,bytes calldata,uint256 valueWei,uint256 gasLimit,bytes32 nonceHash,bytes32 policyIdHash,uint256 deadlineUnix)"
        );

    uint8 internal constant SAFE_OPERATION_CALL = 0;
    uint256 internal constant SECP256K1N_DIV_2 =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    struct SessionPolicy {
        bool active;
        bool paused;
        uint48 validAfter;
        uint48 validUntil;
        uint64 maxGasLimit;
        uint256 maxValueWei;
        bytes32 policyIdHash;
    }

    mapping(address safe => mapping(address sessionKey => SessionPolicy)) public sessionPolicies;
    mapping(address safe => mapping(address sessionKey => mapping(address target => bool))) public allowedTargets;
    mapping(address safe => mapping(address sessionKey => mapping(bytes4 selector => bool))) public allowedSelectors;
    mapping(address safe => mapping(address sessionKey => mapping(bytes32 nonceHash => bool))) public usedNonces;

    event SessionKeyGranted(
        address indexed safe,
        address indexed sessionKey,
        bytes32 indexed policyIdHash,
        uint48 validAfter,
        uint48 validUntil,
        uint64 maxGasLimit,
        uint256 maxValueWei
    );
    event SessionKeyRevoked(address indexed safe, address indexed sessionKey);
    event SessionKeyPaused(address indexed safe, address indexed sessionKey, bool paused);
    event TargetPermissionUpdated(address indexed safe, address indexed sessionKey, address indexed target, bool allowed);
    event SelectorPermissionUpdated(address indexed safe, address indexed sessionKey, bytes4 indexed selector, bool allowed);
    event SessionExecution(
        address indexed safe,
        address indexed sessionKey,
        address indexed target,
        bytes32 nonceHash,
        bytes32 policyIdHash,
        bool success
    );

    error InvalidSessionKey();
    error InvalidValidityWindow();
    error SessionPolicyMissing();
    error SessionKeyPausedError();
    error SessionKeyInactive();
    error SessionKeyNotYetValid();
    error SessionKeyExpired();
    error RequestExpired();
    error PolicyMismatch();
    error TargetNotAllowed();
    error SelectorNotAllowed();
    error NonceAlreadyUsed();
    error ValueExceedsLimit();
    error GasExceedsLimit();
    error InvalidSignature();
    error SafeExecutionFailed();

    /// @notice Grants or overwrites a session key policy for the calling Safe.
    /// @dev Must be called by the Safe itself after the module has been enabled.
    function grantSessionKey(
        address sessionKey,
        bytes32 policyIdHash,
        uint48 validAfter,
        uint48 validUntil,
        uint64 maxGasLimit,
        uint256 maxValueWei,
        address[] calldata targets,
        bytes4[] calldata selectors
    ) external {
        if (sessionKey == address(0)) revert InvalidSessionKey();
        if (validUntil != 0 && validUntil <= validAfter) revert InvalidValidityWindow();

        address safe = msg.sender;
        sessionPolicies[safe][sessionKey] = SessionPolicy({
            active: true,
            paused: false,
            validAfter: validAfter,
            validUntil: validUntil,
            maxGasLimit: maxGasLimit,
            maxValueWei: maxValueWei,
            policyIdHash: policyIdHash
        });

        for (uint256 i = 0; i < targets.length; i++) {
            allowedTargets[safe][sessionKey][targets[i]] = true;
            emit TargetPermissionUpdated(safe, sessionKey, targets[i], true);
        }
        for (uint256 i = 0; i < selectors.length; i++) {
            allowedSelectors[safe][sessionKey][selectors[i]] = true;
            emit SelectorPermissionUpdated(safe, sessionKey, selectors[i], true);
        }

        emit SessionKeyGranted(safe, sessionKey, policyIdHash, validAfter, validUntil, maxGasLimit, maxValueWei);
    }

    /// @notice Revokes a session key policy for the calling Safe.
    function revokeSessionKey(address sessionKey) external {
        delete sessionPolicies[msg.sender][sessionKey];
        emit SessionKeyRevoked(msg.sender, sessionKey);
    }

    /// @notice Pauses or unpauses a granted session key.
    function pauseSessionKey(address sessionKey, bool paused) external {
        SessionPolicy storage policy = sessionPolicies[msg.sender][sessionKey];
        if (!policy.active) revert SessionPolicyMissing();
        policy.paused = paused;
        emit SessionKeyPaused(msg.sender, sessionKey, paused);
    }

    /// @notice Updates target allowlist entries for a session key.
    function setTargetPermissions(address sessionKey, address[] calldata targets, bool allowed) external {
        _requireActivePolicy(msg.sender, sessionKey);
        for (uint256 i = 0; i < targets.length; i++) {
            allowedTargets[msg.sender][sessionKey][targets[i]] = allowed;
            emit TargetPermissionUpdated(msg.sender, sessionKey, targets[i], allowed);
        }
    }

    /// @notice Updates selector allowlist entries for a session key.
    function setSelectorPermissions(address sessionKey, bytes4[] calldata selectors, bool allowed) external {
        _requireActivePolicy(msg.sender, sessionKey);
        for (uint256 i = 0; i < selectors.length; i++) {
            allowedSelectors[msg.sender][sessionKey][selectors[i]] = allowed;
            emit SelectorPermissionUpdated(msg.sender, sessionKey, selectors[i], allowed);
        }
    }

    /// @notice Returns the EIP-712 digest for the provided execution request.
    function relayDigest(
        address safe,
        address target,
        bytes calldata callData,
        uint256 valueWei,
        uint256 gasLimit,
        bytes32 nonceHash,
        bytes32 policyIdHash,
        uint256 deadlineUnix
    ) external view returns (bytes32) {
        return _relayDigest(safe, target, callData, valueWei, gasLimit, nonceHash, policyIdHash, deadlineUnix);
    }

    /// @notice Verifies the session key authorization and forwards the request
    ///         through the target Safe's `execTransactionFromModule`.
    function execute(
        address safe,
        address target,
        bytes calldata callData,
        uint256 valueWei,
        uint256 gasLimit,
        bytes32 nonceHash,
        bytes32 policyIdHash,
        uint256 deadlineUnix,
        bytes calldata signature
    ) external returns (bool success) {
        bytes32 digest = _relayDigest(safe, target, callData, valueWei, gasLimit, nonceHash, policyIdHash, deadlineUnix);
        address sessionKey = _recoverSigner(digest, signature);
        SessionPolicy storage policy = sessionPolicies[safe][sessionKey];

        if (!policy.active) revert SessionKeyInactive();
        if (policy.paused) revert SessionKeyPausedError();
        if (policy.policyIdHash != policyIdHash) revert PolicyMismatch();
        if (policy.validAfter != 0 && block.timestamp < policy.validAfter) revert SessionKeyNotYetValid();
        if (policy.validUntil != 0 && block.timestamp > policy.validUntil) revert SessionKeyExpired();
        if (block.timestamp > deadlineUnix) revert RequestExpired();
        if (!allowedTargets[safe][sessionKey][target]) revert TargetNotAllowed();
        if (callData.length >= 4) {
            bytes4 selector;
            assembly {
                selector := calldataload(callData.offset)
            }
            if (!allowedSelectors[safe][sessionKey][selector]) revert SelectorNotAllowed();
        }
        if (policy.maxValueWei != 0 && valueWei > policy.maxValueWei) revert ValueExceedsLimit();
        if (policy.maxGasLimit != 0 && gasLimit > policy.maxGasLimit) revert GasExceedsLimit();
        if (usedNonces[safe][sessionKey][nonceHash]) revert NonceAlreadyUsed();
        usedNonces[safe][sessionKey][nonceHash] = true;

        success = ISafeModuleExecutor(safe).execTransactionFromModule(
            target,
            valueWei,
            callData,
            SAFE_OPERATION_CALL
        );
        if (!success) revert SafeExecutionFailed();

        emit SessionExecution(safe, sessionKey, target, nonceHash, policyIdHash, success);
    }

    function _requireActivePolicy(address safe, address sessionKey) internal view {
        if (!sessionPolicies[safe][sessionKey].active) revert SessionPolicyMissing();
    }

    function _relayDigest(
        address safe,
        address target,
        bytes calldata callData,
        uint256 valueWei,
        uint256 gasLimit,
        bytes32 nonceHash,
        bytes32 policyIdHash,
        uint256 deadlineUnix
    ) internal view returns (bytes32) {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes(EIP712_NAME)),
                keccak256(bytes(EIP712_VERSION)),
                block.chainid,
                safe
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                SCW_EXECUTION_TYPEHASH,
                target,
                keccak256(callData),
                valueWei,
                gasLimit,
                nonceHash,
                policyIdHash,
                deadlineUnix
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function _recoverSigner(bytes32 digest, bytes calldata signature) internal pure returns (address signer) {
        if (signature.length != 65) revert InvalidSignature();

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert InvalidSignature();
        if (uint256(s) > SECP256K1N_DIV_2) revert InvalidSignature();

        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
    }
}
