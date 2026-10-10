import type { Request, Response } from 'express';
import { extractVerifiedClientIp, deriveNetworkKey } from '../clientip/index.js';

export function handleProbeRequest(req: Request, res: Response, serverSalt: string) {
  const { clientIp, family } = extractVerifiedClientIp(req);
  const groupKey = deriveNetworkKey(clientIp, serverSalt);

  // Probe responses must allow CORS for app origin, GET only, no credentials/cookies
  res.setHeader('Cache-Control', 'no-store, no-cache');
  res.json({
    ip: clientIp,
    family,
    groupKey,
  });
}

export function handleSimpleIpRequest(req: Request, res: Response) {
  const { clientIp } = extractVerifiedClientIp(req);
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Cache-Control', 'no-store, no-cache');
  res.send(clientIp);
}
