pragma solidity ^0.8.24;
import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract CraftingRPGFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    error NotOwner();
    error NotProvider();
    error Paused();
    error InvalidState();
    error RateLimited();
    error BatchClosed();
    error BatchFull();
    error InvalidBatch();
    error InvalidRequest();
    error InvalidCiphertext();
    error StaleWrite();

    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event CooldownUpdated(uint256 oldInterval, uint256 newInterval);
    event BatchOpened(uint256 indexed batchId, address indexed opener);
    event BatchClosed(uint256 indexed batchId, address indexed closer);
    event CraftingSubmitted(address indexed crafter, uint256 indexed batchId, bytes32[] encryptedComponents);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId, address indexed requester);
    event CraftingResultDecrypted(uint256 indexed requestId, uint256 indexed batchId, uint256 result);

    bool public paused;
    uint256 public cooldownSeconds = 30;
    uint256 public constant MAX_BATCH_SIZE = 100;
    uint256 public currentBatchId;
    uint256 public craftingModelVersion;

    mapping(address => bool) public isProvider;
    mapping(address => uint256) public lastActionAt;
    mapping(uint256 => Batch) public batches;
    mapping(uint256 => DecryptionContext) public decryptionContexts;
    mapping(uint256 => mapping(address => uint256)) public userSubmissionsInBatch;

    struct Batch {
        bool isOpen;
        uint256 numSubmissions;
        uint256 accumulator;
        mapping(address => euint32) encryptedSubmissions;
    }

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
        address requester;
    }

    modifier onlyOwner() {
        if (msg.sender != owner()) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier rateLimited() {
        if (block.timestamp < lastActionAt[msg.sender] + cooldownSeconds) {
            revert RateLimited();
        }
        lastActionAt[msg.sender] = block.timestamp;
        _;
    }

    function initializeCraftingModel(uint256 initialVersion) external onlyOwner {
        craftingModelVersion = initialVersion;
    }

    function setCooldown(uint256 newCooldownSeconds) external onlyOwner {
        uint256 oldInterval = cooldownSeconds;
        cooldownSeconds = newCooldownSeconds;
        emit CooldownUpdated(oldInterval, newCooldownSeconds);
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function addProvider(address provider) external onlyOwner {
        isProvider[provider] = true;
        emit ProviderAdded(provider);
    }

    function removeProvider(address provider) external onlyOwner {
        isProvider[provider] = false;
        emit ProviderRemoved(provider);
    }

    function openBatch() external onlyProvider whenNotPaused rateLimited {
        currentBatchId++;
        batches[currentBatchId].isOpen = true;
        batches[currentBatchId].numSubmissions = 0;
        batches[currentBatchId].accumulator = 0;
        emit BatchOpened(currentBatchId, msg.sender);
    }

    function closeBatch(uint256 batchId) external onlyProvider whenNotPaused {
        if (batchId != currentBatchId) revert InvalidBatch();
        if (!batches[batchId].isOpen) revert BatchClosed();
        batches[batchId].isOpen = false;
        emit BatchClosed(batchId, msg.sender);
    }

    function submitEncryptedCraftingComponents(
        uint256 batchId,
        euint32 encryptedComponent1,
        euint32 encryptedComponent2,
        euint32 encryptedComponent3
    ) external whenNotPaused rateLimited {
        if (batchId != currentBatchId) revert InvalidBatch();
        if (!batches[batchId].isOpen) revert BatchClosed();
        if (batches[batchId].numSubmissions >= MAX_BATCH_SIZE) revert BatchFull();

        _requireInitialized(encryptedComponent1, "Component1");
        _requireInitialized(encryptedComponent2, "Component2");
        _requireInitialized(encryptedComponent3, "Component3");

        euint32 memory encryptedCraftingScore = _computeEncryptedCraftingScore(
            encryptedComponent1,
            encryptedComponent2,
            encryptedComponent3
        );

        batches[batchId].encryptedSubmissions[msg.sender] = encryptedCraftingScore;
        batches[batchId].numSubmissions++;
        userSubmissionsInBatch[batchId][msg.sender] = block.timestamp;

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(encryptedCraftingScore);
        emit CraftingSubmitted(msg.sender, batchId, cts);
    }

    function requestBatchResultDecryption(uint256 batchId) external whenNotPaused rateLimited {
        if (batchId != currentBatchId) revert InvalidBatch();
        if (batches[batchId].isOpen) revert BatchClosed();

        euint32 memory encryptedBatchResult = _computeEncryptedBatchResult(batchId);
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(encryptedBatchResult);

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.onCraftingResultDecrypted.selector);

        decryptionContexts[requestId] = DecryptionContext({
            batchId: batchId,
            stateHash: stateHash,
            processed: false,
            requester: msg.sender
        });

        emit DecryptionRequested(requestId, batchId, msg.sender);
    }

    function onCraftingResultDecrypted(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        if (decryptionContexts[requestId].processed) revert InvalidState();
        if (decryptionContexts[requestId].requester == address(0)) revert InvalidRequest();

        DecryptionContext memory context = decryptionContexts[requestId];
        euint32 memory encryptedBatchResult = _computeEncryptedBatchResult(context.batchId);
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(encryptedBatchResult);

        bytes32 currHash = _hashCiphertexts(cts);
        if (currHash != context.stateHash) revert InvalidState();

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint256 result = abi.decode(cleartexts, (uint256));
        decryptionContexts[requestId].processed = true;

        emit CraftingResultDecrypted(requestId, context.batchId, result);
    }

    function _computeEncryptedCraftingScore(
        euint32 component1,
        euint32 component2,
        euint32 component3
    ) internal pure returns (euint32) {
        euint32 memory score = FHE.add(component1, component2);
        score = FHE.add(score, component3);
        return score;
    }

    function _computeEncryptedBatchResult(uint256 batchId) internal view returns (euint32) {
        euint32 memory accumulator = FHE.asEuint32(0);
        uint256 count = 0;

        address[] memory submitters = new address[](batches[batchId].numSubmissions);
        uint256 idx;
        for (uint256 i = 0; i < batches[batchId].numSubmissions; i++) {
            address submitter = submitters[i];
            if (userSubmissionsInBatch[batchId][submitter] > 0) {
                euint32 memory submission = batches[batchId].encryptedSubmissions[submitter];
                if (FHE.isInitialized(submission)) {
                    accumulator = FHE.add(accumulator, submission);
                    count++;
                }
            }
        }

        if (count > 0) {
            euint32 memory countE = FHE.asEuint32(count);
            accumulator = FHE.div(accumulator, countE);
        }
        return accumulator;
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 x) internal pure returns (euint32) {
        if (!FHE.isInitialized(x)) {
            return FHE.asEuint32(0);
        }
        return x;
    }

    function _requireInitialized(euint32 x, string memory tag) internal pure {
        if (!FHE.isInitialized(x)) {
            revert InvalidCiphertext();
        }
    }
}