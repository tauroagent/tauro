// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {SealRegistry} from "../src/SealRegistry.sol";
import {Golden} from "./Golden.sol";

contract SealRegistryTest is Test {
    event Sealed(uint64 indexed hour, bytes32 root, bytes32 prevRoot, uint32 leafCount);

    SealRegistry reg;
    address signer = address(0x5EA1);
    uint64 constant H = 1_763_215_200;

    function setUp() public {
        reg = new SealRegistry(signer);
        vm.warp(H + 3600 + 60);
    }

    function _seal(uint64 hour, bytes32 root) internal {
        bytes32 prev = reg.lastRoot(); // read first: vm.prank applies to the next call only
        vm.prank(signer);
        reg.seal(hour, root, prev, 1);
    }

    function test_constructor_rejects_zero_signer() public {
        vm.expectRevert("signer is zero");
        new SealRegistry(address(0));
    }

    function test_first_seal_links_to_zero_and_emits() public {
        vm.expectEmit(true, false, false, true);
        emit Sealed(H, bytes32(uint256(1)), bytes32(0), 3);
        vm.prank(signer);
        reg.seal(H, bytes32(uint256(1)), bytes32(0), 3);

        assertEq(reg.lastHour(), H);
        assertEq(reg.lastRoot(), bytes32(uint256(1)));
        assertEq(reg.sealCount(), 1);
        SealRegistry.Seal memory s = reg.sealOf(H);
        assertEq(s.root, bytes32(uint256(1)));
        assertEq(s.leafCount, 3);
        assertEq(s.sealedAt, block.timestamp);
        assertTrue(reg.onTime(H));
    }

    function test_only_signer() public {
        vm.expectRevert(SealRegistry.NotSigner.selector);
        reg.seal(H, bytes32(uint256(1)), bytes32(0), 1);
    }

    function test_rejects_partial_hour() public {
        vm.prank(signer);
        vm.expectRevert(abi.encodeWithSelector(SealRegistry.NotWholeHour.selector, H + 1));
        reg.seal(H + 1, bytes32(uint256(1)), bytes32(0), 1);
    }

    function test_rejects_open_hour() public {
        vm.warp(H + 3599);
        vm.prank(signer);
        vm.expectRevert(abi.encodeWithSelector(SealRegistry.HourNotClosed.selector, H));
        reg.seal(H, bytes32(uint256(1)), bytes32(0), 1);
    }

    function test_rejects_same_or_earlier_hour() public {
        _seal(H, bytes32(uint256(1)));
        vm.startPrank(signer);
        vm.expectRevert(abi.encodeWithSelector(SealRegistry.HourNotAfterLast.selector, H, H));
        reg.seal(H, bytes32(uint256(2)), bytes32(uint256(1)), 1);
        vm.expectRevert(abi.encodeWithSelector(SealRegistry.HourNotAfterLast.selector, H - 3600, H));
        reg.seal(H - 3600, bytes32(uint256(2)), bytes32(uint256(1)), 1);
        vm.stopPrank();
    }

    function test_rejects_wrong_prev_root() public {
        _seal(H, bytes32(uint256(1)));
        vm.warp(H + 7200 + 60);
        vm.prank(signer);
        vm.expectRevert(abi.encodeWithSelector(SealRegistry.WrongPrevRoot.selector, bytes32(uint256(1)), bytes32(uint256(9))));
        reg.seal(H + 3600, bytes32(uint256(2)), bytes32(uint256(9)), 1);
    }

    function test_rejects_empty_root_and_no_leaves() public {
        vm.startPrank(signer);
        vm.expectRevert(SealRegistry.EmptyRoot.selector);
        reg.seal(H, bytes32(0), bytes32(0), 1);
        vm.expectRevert(SealRegistry.NoLeaves.selector);
        reg.seal(H, bytes32(uint256(1)), bytes32(0), 0);
        vm.stopPrank();
    }

    function test_skipped_hours_stay_empty_and_late_seal_is_flagged() public {
        _seal(H, bytes32(uint256(1)));
        vm.warp(H + 5 * 3600);
        _seal(H + 2 * 3600, bytes32(uint256(2)));
        assertEq(reg.sealOf(H + 3600).root, bytes32(0));
        assertFalse(reg.onTime(H + 3600));
        assertFalse(reg.onTime(H + 2 * 3600));
        assertEq(reg.sealCount(), 2);
    }

    function test_golden_vectors_from_typescript_verify_on_chain() public {
        vm.warp(Golden.HOUR + 3600 + 1);
        vm.prank(signer);
        reg.seal(Golden.HOUR, Golden.ROOT, bytes32(0), Golden.LEAF_COUNT);
        Golden.Vector[] memory vs = Golden.vectors();
        assertEq(vs.length, Golden.LEAF_COUNT);
        for (uint256 i = 0; i < vs.length; i++) {
            assertTrue(reg.verify(Golden.HOUR, vs[i].leaf, vs[i].proof));
            assertFalse(reg.verify(Golden.HOUR + 3600, vs[i].leaf, vs[i].proof));
            assertFalse(reg.verify(Golden.HOUR, keccak256(abi.encode(vs[i].leaf)), vs[i].proof));
        }
    }

    /// Roots always chain, hours always rise, and only the signer moves state.
    function testFuzz_chain(uint8 steps, uint256 seed) public {
        uint64 hour = H;
        bytes32 prev;
        for (uint256 i = 0; i < uint256(steps) % 24 + 1; i++) {
            bytes32 root = keccak256(abi.encode(seed, i));
            vm.warp(uint256(hour) + 3600);
            vm.prank(signer);
            reg.seal(hour, root, prev, 1);
            assertEq(reg.sealOf(hour).root, root);
            assertEq(reg.lastRoot(), root);
            prev = root;
            hour += uint64(3600 * (1 + (uint256(keccak256(abi.encode(seed, i, "gap"))) % 3)));
        }
        assertEq(reg.sealCount(), uint256(steps) % 24 + 1);
    }
}
