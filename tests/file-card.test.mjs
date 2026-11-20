import assert from "node:assert/strict"
import test from "node:test"
import { fileCardOpenAction } from "../src/file-card.ts"

test("requests the sidebar for Markdown card sources when advertised", async () => {
  const calls = []
  const ui = {
    openFile: async (...args) => calls.push(args),
    openFileTargets: ["main", "sidebar"],
  }
  for (const path of [
    "notes/Research.md",
    "notes/Research.MARKDOWN",
    "images/photo.png",
  ])
    await fileCardOpenAction(ui, path)()
  assert.deepEqual(calls, [
    ["notes/Research.md", { target: "sidebar" }],
    ["notes/Research.MARKDOWN", { target: "sidebar" }],
    ["images/photo.png"],
  ])
})

test("uses a one-argument call when the sidebar is unavailable", async () => {
  const calls = []
  const openFile = async (...args) => calls.push(args)
  const path = "notes/Research.md"
  await fileCardOpenAction({ openFile }, path)()
  await fileCardOpenAction({ openFile, openFileTargets: ["main"] }, path)()
  assert.deepEqual(calls, [[path], [path]])
  assert.equal(
    fileCardOpenAction({ openFileTargets: ["main", "sidebar"] }, path),
    undefined
  )
})
