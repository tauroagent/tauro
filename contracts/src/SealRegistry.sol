// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title SealRegistry
/// @notice Stores one Merkle root per hour of Tauro agent decisions.
/// A root is written once, by one signer, in strictly increasing hour order, and each root
/// names the previous one, so history can be extended but not rewritten. Skipped hours stay
/// skipped: they show up as gaps, never as late inserts.
/// There is no owner, no upgrade path and no pause.
/// @custom:website https://tauroagent.com
/// @custom:repository https://github.com/tauroagent/tauro
contract SealRegistry {
    struct Seal {
        bytes32 root;
        uint32 leafCount;
        uint64 sealedAt;
    }

    /// @notice The only address allowed to seal. Fixed at deploy.
    address public immutable signer;

    /// @notice Unix seconds of the latest sealed hour, 0 before the first seal.
    uint64 public lastHour;

    /// @notice Root of the latest sealed hour, zero before the first seal.
    bytes32 public lastRoot;

    /// @notice Number of hours sealed so far.
    uint64 public sealCount;

    mapping(uint64 hour => Seal) private seals;

    event Sealed(uint64 indexed hour, bytes32 root, bytes32 prevRoot, uint32 leafCount);

    error NotSigner();
    error NotWholeHour(uint64 hour);
    error HourNotAfterLast(uint64 hour, uint64 lastHour);
    error HourNotClosed(uint64 hour);
    error WrongPrevRoot(bytes32 expected, bytes32 given);
    error EmptyRoot();
    error NoLeaves();

    constructor(address signer_) {
        require(signer_ != address(0), "signer is zero");
        signer = signer_;
    }

    /// @notice Seals the decisions of `hour`, which must have closed already.
    /// @param hour Unix seconds at the start of the hour.
    /// @param root Merkle root of the hour's leaves.
    /// @param prevRoot Must equal `lastRoot`, which links every root to the one before it.
    /// @param leafCount Number of leaves under `root`.
    function seal(uint64 hour, bytes32 root, bytes32 prevRoot, uint32 leafCount) external {
        if (msg.sender != signer) revert NotSigner();
        if (hour % 3600 != 0) revert NotWholeHour(hour);
        if (sealCount != 0 && hour <= lastHour) revert HourNotAfterLast(hour, lastHour);
        if (block.timestamp < uint256(hour) + 3600) revert HourNotClosed(hour);
        if (prevRoot != lastRoot) revert WrongPrevRoot(lastRoot, prevRoot);
        if (root == bytes32(0)) revert EmptyRoot();
        if (leafCount == 0) revert NoLeaves();

        seals[hour] = Seal({root: root, leafCount: leafCount, sealedAt: uint64(block.timestamp)});
        lastHour = hour;
        lastRoot = root;
        unchecked {
            ++sealCount;
        }
        emit Sealed(hour, root, prevRoot, leafCount);
    }

    /// @notice The seal for `hour`; all fields are zero if the hour was never sealed.
    function sealOf(uint64 hour) external view returns (Seal memory) {
        return seals[hour];
    }

    /// @notice True if `leaf` is under the root sealed for `hour`.
    function verify(uint64 hour, bytes32 leaf, bytes32[] calldata proof) external view returns (bool) {
        bytes32 root = seals[hour].root;
        return root != bytes32(0) && MerkleProof.verifyCalldata(proof, root, leaf);
    }

    /// @notice True if the seal for `hour` landed before the close of the following hour.
    function onTime(uint64 hour) external view returns (bool) {
        uint64 at = seals[hour].sealedAt;
        return at != 0 && at < hour + 7200;
    }
}
