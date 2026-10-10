import crypto from 'crypto';
import {
  ROOM_CODE_LENGTH,
  ROOM_CODE_ALPHABET,
  ROOM_MAX_PEERS,
  ROOM_IDLE_TTL_MS,
  ROOM_MAX_TTL_MS,
  ROOM_JOIN_RATE_LIMIT_ATTEMPTS,
  ROOM_JOIN_RATE_LIMIT_WINDOW_MS,
} from '@shareapp/shared';

export interface Room {
  code: string;
  creatorId: string;
  passwordHash?: string;
  peerIds: Set<string>;
  createdAt: number;
  lastActivity: number;
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  // ipHash:roomCode -> { failures: number, lockedUntil: number, resetAt: number }
  private joinRateLimits = new Map<string, { failures: number; lockedUntil: number; resetAt: number }>();

  public createRoom(creatorId: string, password?: string): Room {
    let code = '';
    do {
      code = this.generateCode();
    } while (this.rooms.has(code));

    const now = Date.now();
    const room: Room = {
      code,
      creatorId,
      passwordHash: password ? this.hashPassword(password) : undefined,
      peerIds: new Set([creatorId]),
      createdAt: now,
      lastActivity: now,
    };

    this.rooms.set(code, room);
    return room;
  }

  public getRoom(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  public checkRateLimit(ipHash: string, code: string): { allowed: boolean; remainingLockoutMs?: number } {
    const key = `${ipHash}:${code.toUpperCase()}`;
    const now = Date.now();
    const state = this.joinRateLimits.get(key);

    if (!state) return { allowed: true };
    if (state.lockedUntil > now) {
      return { allowed: false, remainingLockoutMs: state.lockedUntil - now };
    }
    if (state.resetAt < now) {
      this.joinRateLimits.delete(key);
      return { allowed: true };
    }
    if (state.failures >= ROOM_JOIN_RATE_LIMIT_ATTEMPTS) {
      state.lockedUntil = now + ROOM_JOIN_RATE_LIMIT_WINDOW_MS;
      return { allowed: false, remainingLockoutMs: ROOM_JOIN_RATE_LIMIT_WINDOW_MS };
    }
    return { allowed: true };
  }

  public recordJoinFailure(ipHash: string, code: string) {
    const key = `${ipHash}:${code.toUpperCase()}`;
    const now = Date.now();
    let state = this.joinRateLimits.get(key);
    if (!state || state.resetAt < now) {
      state = { failures: 1, lockedUntil: 0, resetAt: now + ROOM_JOIN_RATE_LIMIT_WINDOW_MS };
    } else {
      state.failures += 1;
    }
    if (state.failures >= ROOM_JOIN_RATE_LIMIT_ATTEMPTS) {
      state.lockedUntil = now + ROOM_JOIN_RATE_LIMIT_WINDOW_MS;
    }
    this.joinRateLimits.set(key, state);
  }

  public joinRoom(
    code: string,
    deviceId: string,
    password?: string
  ): { success: boolean; error?: string; room?: Room } {
    const normCode = code.toUpperCase();
    const room = this.rooms.get(normCode);
    if (!room) {
      return { success: false, error: 'Room not found' };
    }

    const now = Date.now();
    if (now - room.createdAt > ROOM_MAX_TTL_MS || now - room.lastActivity > ROOM_IDLE_TTL_MS) {
      this.rooms.delete(normCode);
      return { success: false, error: 'Room expired' };
    }

    if (room.passwordHash) {
      if (!password || this.hashPassword(password) !== room.passwordHash) {
        return { success: false, error: 'Invalid room password' };
      }
    }

    if (room.peerIds.size >= ROOM_MAX_PEERS && !room.peerIds.has(deviceId)) {
      return { success: false, error: 'Room is full (max 8 peers)' };
    }

    room.peerIds.add(deviceId);
    room.lastActivity = now;
    return { success: true, room };
  }

  public leaveRoom(code: string, deviceId: string) {
    const room = this.rooms.get(code.toUpperCase());
    if (room) {
      room.peerIds.delete(deviceId);
      room.lastActivity = Date.now();
      if (room.peerIds.size === 0) {
        this.rooms.delete(code.toUpperCase());
      }
    }
  }

  public arePeersInSameRoom(peerA: string, peerB: string): boolean {
    for (const room of this.rooms.values()) {
      if (room.peerIds.has(peerA) && room.peerIds.has(peerB)) {
        return true;
      }
    }
    return false;
  }

  public pruneExpiredRooms() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (now - room.createdAt > ROOM_MAX_TTL_MS || now - room.lastActivity > ROOM_IDLE_TTL_MS) {
        this.rooms.delete(code);
      }
    }
  }

  private generateCode(): string {
    const bytes = crypto.randomBytes(ROOM_CODE_LENGTH);
    let result = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      result += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
    }
    return result;
  }

  private hashPassword(password: string): string {
    return crypto.createHash('sha256').update(`mogroom:${password}`).digest('hex');
  }
}
