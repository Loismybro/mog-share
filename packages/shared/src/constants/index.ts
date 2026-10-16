/**
 * @shareapp/shared constants
 * Section 0: "Put every tunable number (chunk size, watermarks, timeouts, TTLs) in packages/shared/constants. No magic numbers in feature code."
 */

export const PROTOCOL_VERSION = 1;
export const APP_VERSION = '3.0.0';

// ---------------------------------------------------------------------------
// Transfer Engine & Units (Section 4.1 - 4.4)
// ---------------------------------------------------------------------------
export const DEFAULT_CHUNK_SIZE = 16 * 1024; // 16 KiB default
export const MAX_CHUNK_SIZE = 64 * 1024; // 64 KiB ceiling
export const DEFAULT_BLOCK_SIZE = 4 * 1024 * 1024; // 4 MiB (must be multiple of chunk size)

// Flow control watermarks (Layer 1 - Transport)
export const BUFFERED_AMOUNT_LOW_THRESHOLD = 256 * 1024; // 256 KiB
export const BUFFERED_AMOUNT_HIGH_WATERMARK = 1024 * 1024; // 1 MiB

// Credit-based flow control (Layer 2 - Application)
export const DEFAULT_CREDIT_WINDOW_BLOCKS = 4; // 4 blocks = 16 MiB default
export const MIN_CREDIT_WINDOW_BLOCKS = 2; // shrink down to 2 blocks on relayed/slow paths
export const MAX_CREDIT_WINDOW_BLOCKS = 8; // expand up to 8 blocks on fast low-latency paths
export const MAX_BLOCK_RETRIES = 3; // Retry block verification up to 3 times before failing file

// Storage strategy limits (Section 4.6)
export const MEMORY_WRITER_MAX_BYTES = 200 * 1024 * 1024; // 200 MB hard ceiling for memory writer
export const MEMORY_WRITER_WARN_BYTES = 100 * 1024 * 1024; // 100 MB warning threshold
export const STORAGE_QUOTA_SAFETY_MARGIN_PERCENT = 10; // Quota check: free quota >= file size + 10%
export const OPFS_TEMP_FILE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes temporary file cleanup
export const TRANSFER_JOURNAL_DEBOUNCE_MS = 1000; // 1 second debounce for writing transfer journal
export const TRANSFER_JOURNAL_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours expiry for partial transfers

// ---------------------------------------------------------------------------
// Network & WebRTC (Sections 3.3 - 3.8)
// ---------------------------------------------------------------------------
export const DUAL_STACK_PROBE_TIMEOUT_MS = 2500; // 2.5 s timeout for /ip probe
export const LOCAL_GROUP_DISCONNECT_GRACE_MS = 15000; // 15 s grace before removing visible peer
export const LOCAL_GROUP_MAX_VISIBLE = 24; // Cap on auto-discovered devices in same local group

export const ICE_CANDIDATE_POOL_SIZE = 2;
export const ICE_CONNECTING_MAX_MS = 12000; // 12 s max connecting before starting server relay in parallel
export const ICE_DISCONNECTED_GRACE_MS = 4000; // 4 s wait before ICE restart on 'disconnected'
export const ICE_PROBE_PONG_TIMEOUT_MS = 3000; // 3 s ctl ping/pong probe timeout on visibility/pageshow
export const ICE_BACKGROUND_UPGRADE_INTERVAL_MS = 60000; // 60 s background retry for direct path upgrade
export const STATS_POLL_INTERVAL_MS = 2000; // 2 s getStats poll

// Signaling transport ladder & heartbeat (Section 3.5)
export const WS_CONNECT_TIMEOUT_MS = 4000; // 4 s before trying SSE+POST
export const TRANSPORT_LADDER_REATTEMPT_MS = 300000; // 5 min before re-attempting higher transport rung
export const HEARTBEAT_INTERVAL_MS = 20000; // 20 s app-level ping
export const HEARTBEAT_MAX_MISSES = 3; // 3 misses = reconnect
export const RECONNECT_BASE_DELAY_MS = 500; // 500 ms exponential backoff base
export const RECONNECT_MAX_DELAY_MS = 15000; // 15 s backoff cap
export const MAX_SIGNALING_MESSAGE_SIZE = 64 * 1024; // 64 KiB max signaling frame
export const RATE_LIMIT_MESSAGES_PER_SEC = 30; // max 30 msgs/s per socket
export const MISSED_MESSAGES_BUFFER_SEC = 60; // 60 s replay window on resume
export const MISSED_MESSAGES_BUFFER_MAX = 200; // max 200 messages in replay buffer

// Rooms (Section 3.4)
export const ROOM_CODE_LENGTH = 8;
export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Unambiguous 32-char alphabet (no 0, 1, I, O)
export const ROOM_MAX_PEERS = 8;
export const ROOM_IDLE_TTL_MS = 60 * 60 * 1000; // 60 min idle
export const ROOM_MAX_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours max
export const ROOM_JOIN_RATE_LIMIT_ATTEMPTS = 10; // 10 failures
export const ROOM_JOIN_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 min window / lockout

// Coturn / TURN credentials (Section 3.7)
export const TURN_CREDENTIAL_TTL_SEC = 24 * 3600; // 24 hours TTL for REST credentials
export const DEFAULT_TURN_PORT_UDP = 3478;
export const DEFAULT_TURN_PORT_TCP = 3478;
export const DEFAULT_TURN_PORT_TLS = 5349;
export const DEFAULT_TURN_PORT_ALT_TLS = 443;

// Haptics (Section 6)
export const HAPTIC_RATE_LIMIT_MS = 150;
