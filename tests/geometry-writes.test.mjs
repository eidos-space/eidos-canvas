import assert from "node:assert/strict"
import test from "node:test"
import { createGeometryWrites } from "../src/geometry-writes.ts"

const rect = (x) => ({ x, y: 0, width: 100, height: 80 })

test("geometry writes serialize and keep the latest queued rectangle per card", async () => {
  const first = Promise.withResolvers()
  const batches = []
  let idleCalls = 0
  const writes = createGeometryWrites(
    (batch) => {
      batches.push([...batch])
      return batches.length === 1 ? first.promise : Promise.resolve(true)
    },
    () => idleCalls++
  )

  writes.enqueue("a", rect(10))
  await Promise.resolve()
  writes.enqueue("a", rect(20))
  writes.enqueue("b", rect(30))
  writes.enqueue("a", rect(40))
  assert.deepEqual(batches, [[["a", rect(10)]]])
  first.resolve(true)

  assert.equal(await writes.running, true)
  assert.deepEqual(batches[1], [
    ["a", rect(40)],
    ["b", rect(30)],
  ])
  assert.equal(idleCalls, 1)
  assert.equal(writes.running, undefined)
})

test("a rejected geometry basis clears queued edits before the next gesture", async () => {
  const first = Promise.withResolvers()
  const batches = []
  const writes = createGeometryWrites(
    (batch) => {
      batches.push([...batch])
      return batches.length === 1 ? first.promise : Promise.resolve(true)
    },
    () => {}
  )

  writes.enqueue("a", rect(10))
  await Promise.resolve()
  writes.enqueue("a", rect(20))
  first.resolve(false)
  assert.equal(await writes.running, false)

  writes.enqueue("b", rect(30))
  assert.equal(await writes.running, true)
  assert.deepEqual(batches, [[["a", rect(10)]], [["b", rect(30)]]])
})
