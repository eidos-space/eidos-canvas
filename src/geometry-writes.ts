import type { Rect } from "./canvas"

export function createGeometryWrites(
  write: (batch: ReadonlyMap<string, Rect>) => Promise<boolean>,
  onIdle: () => void
) {
  let queued = new Map<string, Rect>()
  let running: Promise<boolean> | undefined

  async function drain() {
    try {
      while (queued.size) {
        const batch = queued
        queued = new Map()
        if (!(await write(batch))) return false
      }
      return true
    } finally {
      queued.clear()
      running = undefined
      onIdle()
    }
  }

  return {
    enqueue(id: string, rect: Rect) {
      queued.set(id, rect)
      running ??= Promise.resolve().then(drain)
    },
    get running() {
      return running
    },
  }
}
