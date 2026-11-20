import assert from "node:assert/strict"
import test from "node:test"
import { fileCardOpenAction } from "../src/file-card.ts"

test("opens Markdown card sources in the sidebar when Lite supports it", () => {
  const openFile = () => {}
  const openFileInSidebar = () => {}
  const ui = { openFile, openFileInSidebar }
  for (const path of ["notes/Research.md", "notes/Research.MARKDOWN"]) {
    assert.equal(fileCardOpenAction(ui, path), openFileInSidebar)
    assert.equal(fileCardOpenAction({ openFileInSidebar }, path), openFileInSidebar)
  }
  assert.equal(fileCardOpenAction(ui, "images/photo.png"), openFile)
})

test("uses the main editor on older hosts and disables opening when unavailable", () => {
  const openFile = () => {}
  assert.equal(fileCardOpenAction({ openFile }, "notes/Research.md"), openFile)
  assert.equal(fileCardOpenAction({}, "notes/Research.md"), undefined)
})
