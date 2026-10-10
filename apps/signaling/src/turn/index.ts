import type { Request, Response } from 'express';
import {
  generateTurnCredentials,
  type IceServerConfig,
  TURN_CREDENTIAL_TTL_SEC,
  DEFAULT_TURN_PORT_UDP,
  DEFAULT_TURN_PORT_TCP,
  DEFAULT_TURN_PORT_TLS,
  DEFAULT_TURN_PORT_ALT_TLS,
} from '@shareapp/shared';

export async function handleTurnCredentialsRequest(
  _req: Request,
  res: Response,
  turnSecret: string,
  turnRealm: string
) {
  try {
    const creds = await generateTurnCredentials(turnSecret, TURN_CREDENTIAL_TTL_SEC);

    const iceServers: IceServerConfig[] = [
      { urls: `stun:${turnRealm}:${DEFAULT_TURN_PORT_UDP}` },
      {
        urls: [
          `turn:${turnRealm}:${DEFAULT_TURN_PORT_UDP}?transport=udp`,
          `turn:${turnRealm}:${DEFAULT_TURN_PORT_TCP}?transport=tcp`,
        ],
        username: creds.username,
        credential: creds.credential,
      },
      {
        urls: [
          `turns:${turnRealm}:${DEFAULT_TURN_PORT_TLS}?transport=tcp`,
          `turns:${turnRealm}:${DEFAULT_TURN_PORT_ALT_TLS}?transport=tcp`,
        ],
        username: creds.username,
        credential: creds.credential,
      },
    ];

    res.json({
      iceServers,
      ttl: creds.ttl,
      expiryUnix: creds.expiryUnix,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to issue TURN credentials' });
  }
}
