import type { Request, Response } from 'express';

export class ServerMetrics {
  public totalConnections = 0;
  public activeSessions = 0;
  public totalMessagesRelayed = 0;
  public totalRelayBytes = 0;
  public totalResumes = 0;
  public totalRoomsCreated = 0;

  public toJSON() {
    return {
      activeSessions: this.activeSessions,
      totalConnections: this.totalConnections,
      totalMessagesRelayed: this.totalMessagesRelayed,
      totalRelayBytes: this.totalRelayBytes,
      totalResumes: this.totalResumes,
      totalRoomsCreated: this.totalRoomsCreated,
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }
}

export function handleHealthz(_req: Request, res: Response) {
  res.status(200).json({ status: 'ok', timestamp: Date.now() });
}

export function handleMetrics(_req: Request, res: Response, metrics: ServerMetrics) {
  res.status(200).json(metrics.toJSON());
}
