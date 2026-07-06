import type { Account } from '@/core/accounts/accounts'
import type { ContentItem } from '@/core/content/types'

export interface PlaybackSession {
  sourceUrl: string // pass to hls.loadSource
  isLive: boolean // live = start at the edge; VOD = start at position 0
  createLoader(): unknown // loader class for Hls { pLoader, fLoader }
  stop(): Promise<void>
}

export interface PlaybackEngine {
  start(account: Account, item: ContentItem, opts?: { bufferSeconds?: number }): Promise<PlaybackSession>
}

export interface FfmpegProc {
  close(problem: string): void
}

export interface EngineDeps {
  home(): Promise<string>
  newId(): string
  mkdir(dir: string): Promise<void>
  mkfifo(path: string): Promise<void>
  rmrf(dir: string): Promise<void>
  spawn(argv: string[]): FfmpegProc
  readFile(path: string): Promise<Uint8Array | null>
  wait(ms: number): Promise<void>
}
