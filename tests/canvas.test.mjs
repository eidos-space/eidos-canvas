import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  canvasBounds,
  changeCanvas,
  edgeGeometry,
  parseCanvas,
  resizeNode,
} from "../src/canvas.ts"
import { decodePath, resolveSpacePath, webUrl } from "../src/paths.ts"

const fixture = readFileSync(
  new URL("../fixtures/Getting started.canvas", import.meta.url),
  "utf8"
)

test("round-trips existing Canvas extensions and styles when editing a card", () => {
  const source = JSON.parse(fixture)
  source.metadata = { owner: "a different Canvas app" }
  source.nodes[1].extra = { note: true }
  source.nodes.push({ id: "future-node", type: "other" })
  const text =
    JSON.stringify(source, null, "\t").replaceAll("\n", "\r\n") + "\r\n"
  const changed = changeCanvas(text, {
    collection: "nodes",
    id: "question",
    operation: "update",
    patch: { x: 71, text: "Updated" },
  })
  const result = JSON.parse(changed)
  assert.deepEqual(result.metadata, source.metadata)
  assert.deepEqual(result.nodes[1], {
    ...source.nodes[1],
    x: 71,
    text: "Updated",
  })
  assert.deepEqual(result.nodes.at(-1), source.nodes.at(-1))
  assert.match(changed, /\r\n\t"nodes"/)
  assert.ok(changed.endsWith("\r\n"))
})

test("places new groups behind existing cards and removes only incident edges", () => {
  const withGroup = changeCanvas(fixture, {
    collection: "nodes",
    id: "new-group",
    operation: "add",
    patch: { type: "group", x: -40, y: -10, width: 100, height: 90 },
  })
  assert.equal(JSON.parse(withGroup).nodes[0].id, "new-group")
  const removed = changeCanvas(withGroup, {
    collection: "nodes",
    id: "question",
    operation: "delete",
  })
  assert.deepEqual(
    parseCanvas(removed).edges.map((edge) => edge.id),
    ["source"]
  )
  assert.throws(() =>
    changeCanvas(removed, {
      collection: "nodes",
      id: "question",
      operation: "update",
      patch: { x: 0 },
    })
  )
})

test("keeps file order, signed coordinates, accents, subpaths and labeled edges", () => {
  const canvas = parseCanvas("\uFEFF" + fixture)
  assert.deepEqual(
    [...canvas.nodes.keys()],
    ["group", "question", "note", "link"]
  )
  assert.equal(canvas.nodes.get("question").x, -408)
  assert.match(canvas.nodes.get("question").color, /^#/)
  assert.equal(canvas.nodes.get("note").subpath, "#Findings")
  assert.deepEqual(
    canvas.edges.map((edge) => edge.label),
    ["Findings", "Source"]
  )
  assert.deepEqual(
    canvas.edges.map((edge) => [edge.fromEnd, edge.toEnd]),
    [
      ["none", "arrow"],
      ["none", "arrow"],
    ]
  )
  assert.deepEqual(canvasBounds(canvas), {
    x: -440,
    y: -210,
    width: 898,
    height: 454,
  })
})

test("allows empty canvases and rejects malformed top-level objects", () => {
  assert.equal(parseCanvas("{}").nodes.size, 0)
  assert.equal(canvasBounds(parseCanvas("{}")), undefined)
  for (const value of ["[", "[]", "null", '{"nodes":null}', '{"edges":{}}'])
    assert.throws(() => parseCanvas(value))
})

test("skips duplicate IDs, unknown node types and connections to missing nodes", () => {
  const value = JSON.parse(fixture)
  value.nodes.push(value.nodes[0], {
    ...value.nodes[1],
    id: "extension",
    type: "future",
  })
  value.edges.push(value.edges[0], {
    id: "dangling",
    fromNode: "question",
    toNode: "extension",
  })
  const canvas = parseCanvas(JSON.stringify(value))
  assert.equal(canvas.nodes.size, 4)
  assert.equal(canvas.edges.length, 2)
  assert.equal(canvas.skipped, 4)
})

test("routes unspecified sides and includes self connections in fit bounds", () => {
  const value = JSON.parse(fixture)
  value.nodes = value.nodes.slice(1, 3)
  value.edges = [
    { id: "auto", fromNode: "question", toNode: "note" },
    {
      id: "loop",
      fromNode: "question",
      fromSide: "left",
      toNode: "question",
      toSide: "left",
      fromEnd: "arrow",
      toEnd: "none",
    },
  ]
  const { nodes, edges, skipped } = parseCanvas(JSON.stringify(value))
  const question = nodes.get("question")
  const note = nodes.get("note")
  const auto = edgeGeometry(edges[0], question, note)
  assert.equal(auto.start.x, question.x + question.width)
  assert.equal(auto.end.x, note.x)
  const loop = edgeGeometry(edges[1], question, question)
  assert.equal(edges[1].fromEnd, "arrow")
  assert.equal(edges[1].toEnd, "none")
  assert.notEqual(loop.start.y, loop.end.y)
  assert.ok(loop.label.x < question.x)
  assert.equal(skipped, 0)
  assert.ok(canvasBounds({ nodes, edges, skipped }).x < question.x)
})

test("resizing keeps the opposite corner fixed and updates connection geometry", () => {
  const { nodes, edges } = parseCanvas(fixture)
  const question = nodes.get("question")
  const note = nodes.get("note")
  const enlarged = resizeNode(question, "se", 75, 22)
  assert.deepEqual(enlarged, { x: -408, y: -155, width: 373, height: 227 })
  assert.equal(edgeGeometry(edges[0], enlarged, note).start.x, -35)
  const clamped = resizeNode(question, "nw", 400, 400)
  assert.deepEqual(clamped, { x: -158, y: 10, width: 48, height: 40 })
  assert.deepEqual(
    resizeNode({ x: 0, y: 0, width: 12, height: 16 }, "se", 0, 0),
    {
      x: 0,
      y: 0,
      width: 12,
      height: 16,
    }
  )
})

test("resolves references within the Space and rejects local escape and non-web links", () => {
  assert.equal(resolveSpacePath("notes/weekly.md"), "notes/weekly.md")
  assert.equal(
    resolveSpacePath("../assets/map.png", "notes/project.canvas"),
    "assets/map.png"
  )
  assert.equal(resolveSpacePath("assets\\map.png"), "assets/map.png")
  assert.equal(decodePath("word%20one.md"), "word one.md")
  for (const path of [
    "../private.md",
    "/etc/passwd",
    "C:\\temp",
    "https://example.test",
    "line\nbreak",
  ])
    assert.equal(resolveSpacePath(path), undefined)
  assert.equal(webUrl("https://jsoncanvas.org/").hostname, "jsoncanvas.org")
  assert.equal(webUrl("javascript:example"), undefined)
})
