import { Transform, TransformCallback } from 'stream';

/**
 * Token-bucket byte-rate throttle stream.
 * Dynamically queries `getRateLimit()` so users can change speed limits live
 * while downloads are running without restarting connections.
 */
export class DynamicThrottleStream extends Transform {
  private getRateLimit: () => number; // bytes per second (0 = unlimited)
  private tokens: number = 0;
  private lastRefill: number = Date.now();
  private timer: NodeJS.Timeout | null = null;

  constructor(getRateLimit: () => number) {
    super({ highWaterMark: 256 * 1024 });
    this.getRateLimit = getRateLimit;
  }

  private refillTokens(limit: number): void {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    this.lastRefill = now;
    // Cap burst at 0.25 seconds worth of tokens (min 16KB) for smooth pacing
    const maxBurst = Math.max(16 * 1024, limit * 0.25);
    this.tokens = Math.min(maxBurst, this.tokens + elapsedSec * limit);
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    const limit = this.getRateLimit();
    if (!limit || limit <= 0) {
      this.push(chunk);
      callback();
      return;
    }

    this.processChunk(chunk, 0, callback);
  }

  private processChunk(chunk: Buffer, offset: number, callback: TransformCallback): void {
    if (this.destroyed) {
      callback();
      return;
    }

    const limit = this.getRateLimit();
    if (!limit || limit <= 0) {
      this.push(offset === 0 ? chunk : chunk.subarray(offset));
      callback();
      return;
    }

    this.refillTokens(limit);

    const remaining = chunk.length - offset;
    if (this.tokens >= remaining) {
      this.tokens -= remaining;
      this.push(offset === 0 ? chunk : chunk.subarray(offset));
      callback();
      return;
    }

    // Slice into smaller paced subchunks if we have at least 4KB available
    const minSlice = Math.min(remaining, Math.max(4096, Math.floor(limit * 0.1)));
    if (this.tokens >= minSlice) {
      const sendLen = Math.min(remaining, Math.floor(this.tokens));
      this.tokens -= sendLen;
      this.push(chunk.subarray(offset, offset + sendLen));
      const nextOffset = offset + sendLen;
      if (nextOffset >= chunk.length) {
        callback();
        return;
      }
      this.scheduleNext(chunk, nextOffset, limit, callback);
      return;
    }

    this.scheduleNext(chunk, offset, limit, callback);
  }

  private scheduleNext(
    chunk: Buffer,
    offset: number,
    limit: number,
    callback: TransformCallback
  ): void {
    const needed = Math.min(chunk.length - offset, Math.max(4096, Math.floor(limit * 0.1)));
    const deficit = Math.max(1, needed - this.tokens);
    const waitMs = Math.max(10, Math.min(500, Math.ceil((deficit / limit) * 1000)));

    this.timer = setTimeout(() => {
      this.timer = null;
      this.processChunk(chunk, offset, callback);
    }, waitMs);
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    callback(error);
  }
}
