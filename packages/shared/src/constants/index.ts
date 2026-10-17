/**
 * @shareapp/shared constants
 */

export const PROTOCOL_VERSION = 1;
export const APP_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// High-Throughput Multi-Route Transfer Engine Constants
// ---------------------------------------------------------------------------
export const DEFAULT_CHUNK_SIZE = 60 * 1024; // 60 KiB payload (fits safely inside 64 KiB SCTP limit with 17B header)
export const MAX_CHUNK_SIZE = 64 * 1024; // 64 KiB ceiling
export const DEFAULT_BLOCK_SIZE = 512 * 1024; // 512 KiB blocks (~9 chunks) for ultra-fast streaming ACK turnaround & zero stall on WAN/LAN

// Flow control watermarks (Layer 1 - Transport)
export const BUFFERED_AMOUNT_LOW_THRESHOLD = 512 * 1024; // 512 KiB low watermark
export const BUFFERED_AMOUNT_HIGH_WATERMARK = 8 * 1024 * 1024; // 8 MiB high watermark for full multi-channel saturation

// Credit-based flow control (Layer 2 - Application)
export const DEFAULT_CREDIT_WINDOW_BLOCKS = 16; // 16 blocks = 8 MiB in-flight sliding window
export const MIN_CREDIT_WINDOW_BLOCKS = 8;
export const MAX_CREDIT_WINDOW_BLOCKS = 48;
export const MAX_BLOCK_RETRIES = 6;

// Storage strategy limits
export const MEMORY_WRITER_MAX_BYTES = 200 * 1024 * 1024; // 200 MB unit-test baseline (browser runtime dynamically scales up to 2 GB)
export const MEMORY_WRITER_WARN_BYTES = 150 * 1024 * 1024;
export const STORAGE_QUOTA_SAFETY_MARGIN_PERCENT = 2;
export const OPFS_TEMP_FILE_EXPIRY_MS = 60 * 60 * 1000; // 1 hour so active session files never expire prematurely
export const TRANSFER_JOURNAL_DEBOUNCE_MS = 1000;
export const TRANSFER_JOURNAL_EXPIRY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Network & WebRTC
// ---------------------------------------------------------------------------
export const DUAL_STACK_PROBE_TIMEOUT_MS = 1200;
export const LOCAL_GROUP_DISCONNECT_GRACE_MS = 8000; // 8 s grace period
export const LOCAL_GROUP_MAX_VISIBLE = 24;

export const ICE_CANDIDATE_POOL_SIZE = 8;
export const ICE_CONNECTING_MAX_MS = 6000;
export const ICE_DISCONNECTED_GRACE_MS = 3500;
export const ICE_PROBE_PONG_TIMEOUT_MS = 2500;
export const ICE_BACKGROUND_UPGRADE_INTERVAL_MS = 10000;
export const STATS_POLL_INTERVAL_MS = 1500;

// Signaling transport ladder & heartbeat
export const WS_CONNECT_TIMEOUT_MS = 7000;
export const TRANSPORT_LADDER_REATTEMPT_MS = 15000;
export const HEARTBEAT_INTERVAL_MS = 10000;
export const HEARTBEAT_MAX_MISSES = 3;
export const RECONNECT_BASE_DELAY_MS = 300;
export const RECONNECT_MAX_DELAY_MS = 5000;
export const MAX_SIGNALING_MESSAGE_SIZE = 16 * 1024 * 1024; // 16 MiB max signaling/turbo-relay frame
export const RATE_LIMIT_MESSAGES_PER_SEC = 5000; // Allow high-rate multi-route signaling & relay bursts
export const MISSED_MESSAGES_BUFFER_SEC = 90;
export const MISSED_MESSAGES_BUFFER_MAX = 400;

// Rooms
export const ROOM_CODE_LENGTH = 8;
export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const ROOM_MAX_PEERS = 8;
export const ROOM_IDLE_TTL_MS = 60 * 60 * 1000;
export const ROOM_MAX_TTL_MS = 24 * 60 * 60 * 1000;
export const ROOM_JOIN_RATE_LIMIT_ATTEMPTS = 10;
export const ROOM_JOIN_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

// Coturn / TURN credentials
export const TURN_CREDENTIAL_TTL_SEC = 24 * 3600;
export const DEFAULT_TURN_PORT_UDP = 3478;
export const DEFAULT_TURN_PORT_TCP = 3478;
export const DEFAULT_TURN_PORT_TLS = 5349;
export const DEFAULT_TURN_PORT_ALT_TLS = 443;

// Haptics
export const HAPTIC_RATE_LIMIT_MS = 150;
