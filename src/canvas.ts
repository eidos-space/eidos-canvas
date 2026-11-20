export type Side = "top" | "right" | "bottom" | "left"
type End = "none" | "arrow"
type BackgroundStyle = "cover" | "ratio" | "repeat"

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type ResizeCorner = "nw" | "ne" | "sw" | "se"

export function resizeNode(
  rect: Rect,
  corner: ResizeCorner,
  dx: number,
  dy: number
): Rect {
  const west = corner.endsWith("w")
  const north = corner.startsWith("n")
  const width = Math.max(
    Math.min(48, rect.width),
    rect.width + (west ? -dx : dx)
  )
  const height = Math.max(
    Math.min(40, rect.height),
    rect.height + (north ? -dy : dy)
  )
  return {
    x: west ? rect.x + rect.width - width : rect.x,
    y: north ? rect.y + rect.height - height : rect.y,
    width,
    height,
  }
}

interface BaseNode extends Rect {
  id: string
  color?: string
}

export type CanvasNode = BaseNode &
  (
    | { type: "text"; text: string }
    | { type: "file"; file: string; subpath?: string }
    | { type: "link"; url: string }
    | {
        type: "group"
        label?: string
        background?: string
        backgroundStyle?: BackgroundStyle
      }
  )

export interface CanvasEdge {
  id: string
  fromNode: string
  toNode: string
  fromSide?: Side
  toSide?: Side
  fromEnd: End
  toEnd: End
  color?: string
  label?: string
}

export interface Canvas {
  nodes: Map<string, CanvasNode>
  edges: CanvasEdge[]
  skipped: number
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value)
}

export const canvasColors: Record<string, string> = {
  "1": "#e66a68",
  "2": "#d8834b",
  "3": "#c69b30",
  "4": "#59a775",
  "5": "#46a8b8",
  "6": "#9980ce",
}

function color(value: unknown): string | undefined {
  if (typeof value !== "string") return
  if (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value))
    return value
  if (Object.hasOwn(canvasColors, value)) return canvasColors[value]
}

function side(value: unknown): Side | undefined {
  if (
    value === "top" ||
    value === "right" ||
    value === "bottom" ||
    value === "left"
  )
    return value
}

function parseNode(value: unknown): CanvasNode | undefined {
  if (!isObject(value)) return
  const { id, type, x, y, width, height } = value
  if (
    typeof id !== "string" ||
    !integer(x) ||
    !integer(y) ||
    !integer(width) ||
    width <= 0 ||
    !integer(height) ||
    height <= 0
  )
    return

  const base = { id, x, y, width, height, color: color(value.color) }
  switch (type) {
    case "text":
      if (typeof value.text === "string")
        return { ...base, type, text: value.text }
      break
    case "file":
      if (typeof value.file === "string") {
        const subpath = string(value.subpath)
        return {
          ...base,
          type,
          file: value.file,
          subpath: subpath?.startsWith("#") ? subpath : undefined,
        }
      }
      break
    case "link":
      if (typeof value.url === "string")
        return { ...base, type, url: value.url }
      break
    case "group": {
      const style = value.backgroundStyle
      const backgroundStyle =
        style === "cover" || style === "ratio" || style === "repeat"
          ? style
          : undefined
      return {
        ...base,
        type,
        label: string(value.label),
        background: string(value.background),
        backgroundStyle,
      }
    }
  }
}

function parseEdge(value: unknown): CanvasEdge | undefined {
  if (!isObject(value)) return
  const { id, fromNode, toNode } = value
  if (
    typeof id !== "string" ||
    typeof fromNode !== "string" ||
    typeof toNode !== "string"
  )
    return
  return {
    id,
    fromNode,
    toNode,
    fromSide: side(value.fromSide),
    toSide: side(value.toSide),
    fromEnd: value.fromEnd === "arrow" ? "arrow" : "none",
    toEnd: value.toEnd === "none" ? "none" : "arrow",
    color: color(value.color),
    label: string(value.label),
  }
}

function readCanvasSource(text: string) {
  const value: unknown = JSON.parse(text.replace(/^\uFEFF/, ""))
  if (!isObject(value)) throw new Error("Expected a JSON Canvas object")
  for (const list of [value.nodes, value.edges]) {
    if (list !== undefined && !Array.isArray(list))
      throw new Error("Expected nodes and edges to be arrays")
  }
  return {
    value,
    nodes: (value.nodes ?? []) as unknown[],
    edges: (value.edges ?? []) as unknown[],
  }
}

export function parseCanvas(text: string): Canvas {
  const source = readCanvasSource(text)
  const nodes = new Map<string, CanvasNode>()
  const edges: CanvasEdge[] = []
  const edgeIds = new Set<string>()
  let skipped = 0
  for (const item of source.nodes) {
    const node = parseNode(item)
    if (!node || nodes.has(node.id)) {
      skipped++
      continue
    }
    nodes.set(node.id, node)
  }
  for (const item of source.edges) {
    const edge = parseEdge(item)
    if (
      !edge ||
      edgeIds.has(edge.id) ||
      !nodes.has(edge.fromNode) ||
      !nodes.has(edge.toNode)
    ) {
      skipped++
      continue
    }
    edges.push(edge)
    edgeIds.add(edge.id)
  }
  return { nodes, edges, skipped }
}

export type CanvasChange = {
  collection: "nodes" | "edges"
  id: string
} & (
  | { operation: "add" | "update"; patch: Record<string, unknown> }
  | { operation: "delete" }
)

function applyCanvasChange(
  source: ReturnType<typeof readCanvasSource>,
  change: CanvasChange
) {
  const items = source[change.collection]
  const matches = (item: unknown) => isObject(item) && item.id === change.id
  const index = items.findIndex(matches)
  if (change.operation === "add") {
    if (index >= 0) throw new Error("Canvas ID already exists")
    const item: Record<string, unknown> = { ...change.patch, id: change.id }
    if (change.collection === "nodes" && item.type === "group")
      items.unshift(item)
    else items.push(item)
    source.value[change.collection] = items
  } else if (index < 0) {
    throw new Error("Canvas item is missing")
  } else if (change.operation === "update") {
    items[index] = {
      ...(items[index] as Record<string, unknown>),
      ...change.patch,
      id: change.id,
    }
  } else {
    source[change.collection] = items.filter((item) => !matches(item))
    source.value[change.collection] = source[change.collection]
    if (change.collection === "nodes" && source.value.edges !== undefined) {
      source.edges = source.edges.filter(
        (edge) =>
          !isObject(edge) ||
          (edge.fromNode !== change.id && edge.toNode !== change.id)
      )
      source.value.edges = source.edges
    }
  }
}

export function changeCanvas(
  text: string,
  change: CanvasChange | CanvasChange[]
): string {
  const source = readCanvasSource(text)
  for (const item of Array.isArray(change) ? change : [change])
    applyCanvasChange(source, item)
  // Edit the original object so fields and item kinds understood by other Canvas apps survive.
  const indent =
    /\r?\n([ \t]+)"/.exec(text)?.[1] ?? (text.includes("\n") ? "  " : "")
  let result = JSON.stringify(source.value, null, indent)
  if (text.endsWith("\n")) result += "\n"
  return text.includes("\r\n") ? result.replaceAll("\n", "\r\n") : result
}

export interface Point {
  x: number
  y: number
}
const normal: Record<Side, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
}

function center(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

function facing(rect: Rect, target: Rect, fallback: Side): Side {
  const a = center(rect)
  const b = center(target)
  const dx = (b.x - a.x) / rect.width
  const dy = (b.y - a.y) / rect.height
  if (dx === 0 && dy === 0) return fallback
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? "left" : "right"
  return dy < 0 ? "top" : "bottom"
}

function port(rect: Rect, side: Side, fraction: number): Point {
  if (side === "top" || side === "bottom") {
    return {
      x: rect.x + rect.width * fraction,
      y: rect.y + (side === "bottom" ? rect.height : 0),
    }
  }
  return {
    x: rect.x + (side === "right" ? rect.width : 0),
    y: rect.y + rect.height * fraction,
  }
}

function offset(point: Point, direction: Point, distance: number): Point {
  return {
    x: point.x + direction.x * distance,
    y: point.y + direction.y * distance,
  }
}

export function edgeGeometry(edge: CanvasEdge, from: Rect, to: Rect) {
  const loop = edge.fromNode === edge.toNode
  const fromSide = edge.fromSide ?? facing(from, to, "right")
  const toSide = edge.toSide ?? facing(to, from, loop ? fromSide : "left")
  const samePort = loop && fromSide === toSide
  const start = port(from, fromSide, samePort ? 0.36 : 0.5)
  const end = port(to, toSide, samePort ? 0.64 : 0.5)
  const reach = Math.max(
    loop ? 70 : 28,
    Math.min(240, Math.hypot(end.x - start.x, end.y - start.y) * 0.43)
  )
  const startDirection = normal[fromSide]
  const endDirection = normal[toSide]
  const control1 = offset(start, startDirection, reach)
  const control2 = offset(end, endDirection, reach)
  const label = {
    x: (start.x + 3 * control1.x + 3 * control2.x + end.x) / 8,
    y: (start.y + 3 * control1.y + 3 * control2.y + end.y) / 8,
  }
  return { start, end, control1, control2, startDirection, endDirection, label }
}

export function canvasBounds(canvas: Canvas): Rect | undefined {
  if (!canvas.nodes.size) return
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  const include = (x: number, y: number) => {
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x)
    bottom = Math.max(bottom, y)
  }
  for (const node of canvas.nodes.values()) {
    include(node.x, node.y)
    include(node.x + node.width, node.y + node.height)
  }
  for (const edge of canvas.edges) {
    const from = canvas.nodes.get(edge.fromNode)
    const to = canvas.nodes.get(edge.toNode)
    if (!from || !to) continue
    const { control1, control2 } = edgeGeometry(edge, from, to)
    include(control1.x, control1.y)
    include(control2.x, control2.y)
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}
