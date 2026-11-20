import type { Mount, TextSnapshot } from "@eidos.space/plugin-sdk"
import { canvasBounds, changeCanvas, edgeGeometry, parseCanvas } from "./canvas"
import type { Canvas, CanvasChange, Point, Rect } from "./canvas"
import { createContent } from "./content"
import { createEditor } from "./editor"
import { createGeometryWrites } from "./geometry-writes"
import { icon } from "./icons"
import { labelToolbarButton } from "./toolbar-label"
import { createViewport } from "./viewport"
import "./style.css"

const svgNamespace = "http://www.w3.org/2000/svg"
const xy = ({ x, y }: Point) => `${x},${y}`

function sameSnapshot(a: TextSnapshot | undefined, b: TextSnapshot) {
  return (
    a?.version === b.version &&
    a.dirty === b.dirty &&
    a.conflicted === b.conflicted
  )
}

function arrowPoints(tip: Point, direction: Point) {
  const base = { x: tip.x + direction.x * 11, y: tip.y + direction.y * 11 }
  const a = { x: base.x - direction.y * 4.8, y: base.y + direction.x * 4.8 }
  const b = { x: base.x + direction.y * 4.8, y: base.y - direction.x * 4.8 }
  return [tip, a, b].map(xy).join(" ")
}

function drawEdges(canvas: Canvas, defaultLabel: string) {
  const svg = document.createElementNS(svgNamespace, "svg")
  svg.setAttribute("class", "edges")
  svg.setAttribute("width", "1")
  svg.setAttribute("height", "1")
  const incident = new Map<string, Array<() => void>>()
  const nodeBounds = new Map<string, Rect>(canvas.nodes)

  for (const edge of canvas.edges) {
    const from = canvas.nodes.get(edge.fromNode)
    const to = canvas.nodes.get(edge.toNode)
    if (!from || !to) continue
    const group = document.createElementNS(svgNamespace, "g")
    group.dataset.edgeId = edge.id
    group.setAttribute("tabindex", "0")
    group.setAttribute("role", "button")
    group.setAttribute("aria-label", edge.label || defaultLabel)
    const ink = edge.color ?? "var(--edge-ink)"
    group.style.color = ink
    const path = document.createElementNS(svgNamespace, "path")
    path.setAttribute("class", "edge-line")
    const hit = path.cloneNode() as SVGPathElement
    hit.setAttribute("class", "edge-hit")
    group.append(path, hit)

    function arrow() {
      const head = document.createElementNS(svgNamespace, "polygon")
      head.setAttribute("fill", "currentColor")
      group.append(head)
      return head
    }
    const startArrow = edge.fromEnd === "arrow" ? arrow() : undefined
    const endArrow = edge.toEnd === "arrow" ? arrow() : undefined
    const label = edge.label
      ? document.createElementNS(svgNamespace, "text")
      : undefined
    if (label) {
      label.setAttribute("class", "edge-label")
      label.textContent = edge.label ?? ""
      group.append(label)
    }

    function update(geometry: ReturnType<typeof edgeGeometry>) {
      const { start, end, control1, control2, startDirection, endDirection } =
        geometry
      const d = `M ${xy(start)} C ${xy(control1)} ${xy(control2)} ${xy(end)}`
      path.setAttribute("d", d)
      hit.setAttribute("d", d)
      startArrow?.setAttribute("points", arrowPoints(start, startDirection))
      endArrow?.setAttribute("points", arrowPoints(end, endDirection))
      label?.setAttribute("x", String(geometry.label.x))
      label?.setAttribute("y", String(geometry.label.y))
    }

    const preview = () =>
      update(
        edgeGeometry(edge, nodeBounds.get(from.id)!, nodeBounds.get(to.id)!)
      )
    for (const id of new Set([edge.fromNode, edge.toNode])) {
      const connected = incident.get(id)
      if (connected) connected.push(preview)
      else incident.set(id, [preview])
    }
    preview()
    svg.append(group)
  }
  return {
    svg,
    previewNode(id: string, rect: Rect) {
      nodeBounds.set(id, rect)
      for (const preview of incident.get(id) ?? []) preview()
    },
  }
}

const mount: Mount = (ctx, root) => {
  const t = (key: string) => ctx.i18n.t(key)
  const filesystem = ctx.capabilities.fs
  const documentCapability = ctx.capabilities.document
  const boundPath =
    ctx.binding.kind === "file" ? ctx.binding.file.path : undefined
  if (!filesystem || !boundPath || !documentCapability) {
    root.textContent = t("read.error")
    return
  }
  const fs = filesystem
  const path = boundPath
  const workingCopy = documentCapability

  const app = document.createElement("main")
  app.className = "canvas-viewer"
  const viewport = document.createElement("div")
  viewport.className = "viewport"
  viewport.tabIndex = 0
  viewport.setAttribute("role", "region")
  viewport.setAttribute("aria-keyshortcuts", "I T F L G")
  const scene = document.createElement("div")
  scene.className = "scene"
  const sceneArt = document.createElement("div")
  scene.append(sceneArt)
  viewport.append(scene)

  const status = document.createElement("div")
  status.className = "status"
  status.setAttribute("role", "status")
  const message = document.createElement("span")
  status.append(message)

  const toolbar = document.createElement("div")
  toolbar.className = "toolbar"
  toolbar.hidden = true
  const saveState = document.createElement("span")
  saveState.className = "save-state"
  saveState.setAttribute("role", "status")
  saveState.hidden = true
  const feedback = document.createElement("div")
  feedback.className = "canvas-feedback"
  feedback.setAttribute("role", "status")
  let feedbackTimer = 0
  function clearFeedback() {
    window.clearTimeout(feedbackTimer)
    feedback.textContent = ""
  }
  function showFeedback(text: string, anchor: HTMLElement, duration = 2500) {
    clearFeedback()
    feedback.textContent = text
    const frame = app.getBoundingClientRect()
    const source = anchor.getBoundingClientRect()
    const width = feedback.offsetWidth
    const height = feedback.offsetHeight
    const left = source.left - frame.left + (source.width - width) / 2
    const above = source.top - frame.top - height - 6
    const top = above >= 8 ? above : source.bottom - frame.top + 6
    feedback.style.left = `${Math.max(8, Math.min(left, frame.width - width - 8))}px`
    feedback.style.top = `${Math.max(8, Math.min(top, frame.height - height - 8))}px`
    feedbackTimer = window.setTimeout(clearFeedback, duration)
  }
  for (const type of ["pointerdown", "wheel"] as const)
    app.addEventListener(type, clearFeedback, {
      signal: ctx.signal,
      capture: true,
    })
  ctx.signal.addEventListener("abort", clearFeedback, { once: true })
  let lastPercent = 100
  let statusKey = ""
  let skipped = 0
  let state: "loading" | "ready" | "empty" | "error" = "loading"
  let rendering: AbortController | undefined
  let snapshot: TextSnapshot | undefined
  let model: Canvas | undefined
  let busy = false
  let notifications = 0
  let observing = false
  let invalidated = false
  let refreshing = false
  let renderedEdges: ReturnType<typeof drawEdges> | undefined
  let renderedContent: ReturnType<typeof createContent> | undefined
  const geometryWrites = createGeometryWrites(writeGeometry, () => {
    if (ctx.signal.aborted) return
    refreshEditor()
    void refreshDocument()
  })

  function button(
    text: string,
    className: string,
    action: () => void,
    shortcut?: string
  ) {
    const item = document.createElement("button")
    item.className = className
    item.type = "button"
    item.textContent = text
    item.addEventListener("click", action, { signal: ctx.signal })
    if (shortcut) item.setAttribute("aria-keyshortcuts", shortcut)
    return item
  }

  const zoomOut = button("−", "zoom-button", () => controls.zoomOut(), "-")
  const percent = button("", "zoom-percent", () => controls.resetZoom())
  const percentLabel = document.createTextNode("100%")
  percent.append(percentLabel)
  const zoomIn = button("+", "zoom-button", () => controls.zoomIn(), "=")
  const fit = button("", "fit-button", () => controls.fit(), "0")
  fit.append(icon("fit"))
  const viewTools = document.createElement("div")
  viewTools.className = "view-tools"
  const reload = button("", "reload-button", () => void load())
  status.append(reload)
  app.append(viewport, status, toolbar, saveState, feedback)
  root.replaceChildren(app)

  const controls = createViewport(
    viewport,
    scene,
    (value) => {
      if (lastPercent === value) return
      lastPercent = value
      percentLabel.data = value + "%"
    },
    ctx.signal
  )
  const editor = createEditor(
    scene,
    controls,
    t,
    {
      edit: (change) =>
        perform(async (current) => {
          if (!model) return false
          const text = changeCanvas(current.text, change)
          const action = (Array.isArray(change) ? change[0] : change)?.operation
          const result = await workingCopy.edit({
            text,
            expectedVersion: current.version,
            label: t(
              action === "delete" ? "delete" : action === "add" ? "add" : "edit"
            ),
          })
          show(result.snapshot)
          if (result.status === "stale") setStatus("stale")
          return result.status === "applied"
        }),
      async save() {
        await perform(async () => {
          const result = await workingCopy.save()
          show(result.snapshot)
          return result.status === "saved"
        })
      },
      async history(direction) {
        await perform(async () => {
          show(await workingCopy[direction]())
          return true
        })
      },
      status: (key) => setStatus(key, model?.skipped ?? 0),
      previewNode: (id, rect) => renderedEdges?.previewNode(id, rect),
      commitGeometry(id, rect) {
        const node = model?.nodes.get(id)
        if (!node || !model || !snapshot || busy || ctx.signal.aborted)
          return false
        model.nodes.set(id, { ...node, ...rect })
        controls.setBounds(canvasBounds(model))
        geometryWrites.enqueue(id, rect)
        refreshEditor()
        return true
      },
      fileExists: async (target) =>
        (await fs.stat(target).catch(() => null))?.isDirectory === false,
    },
    ctx.signal
  )
  viewTools.append(editor.history, zoomOut, percent, zoomIn, fit)
  toolbar.append(editor.tools, viewTools)
  app.append(editor.inspector, editor.menu, editor.toolHint)

  function refreshEditor() {
    editor.update(model, busy, snapshot?.conflicted ?? false)
    toolbar.hidden = !model
    for (const button of [zoomOut, percent, zoomIn, fit])
      button.disabled = !model?.nodes.size
    saveState.hidden = !snapshot?.dirty && !geometryWrites.running
  }

  function updateLabels() {
    editor.updateLabels()
    viewport.setAttribute("aria-label", t("canvas"))
    toolbar.setAttribute("aria-label", t("canvas.controls"))
    saveState.textContent = t("unsaved")
    saveState.title = t("save.hint")
    labelToolbarButton(zoomOut, t("zoom.out"), "−")
    labelToolbarButton(percent, t("zoom.reset"))
    labelToolbarButton(zoomIn, t("zoom.in"), "+")
    labelToolbarButton(fit, t("fit"))
    reload.textContent = t("reload")
    message.textContent = [
      statusKey ? t(statusKey) : "",
      skipped ? ctx.i18n.t("skipped", { count: skipped }) : "",
    ]
      .filter(Boolean)
      .join(" ")
  }
  ctx.subscriptions.add(ctx.i18n.onDidChangeLocale(updateLabels))

  function setStatus(key = "", count = 0) {
    if (key === statusKey && count === skipped && status.dataset.mode === state)
      return
    statusKey = key
    skipped = count
    status.hidden = !key && !count
    status.dataset.mode = state
    reload.hidden = state !== "error"
    updateLabels()
  }
  status.hidden = true

  function draw(data: Canvas) {
    rendering?.abort()
    rendering = new AbortController()
    const signal = AbortSignal.any([ctx.signal, rendering.signal])
    const content = createContent(
      ctx,
      fs,
      path,
      signal,
      showFeedback,
      editor.relinkFile
    )
    renderedContent = content
    const fragment = document.createDocumentFragment()
    const visibleAssets = new Map<Element, () => void>()
    renderedEdges = drawEdges(data, t("edge"))
    fragment.append(renderedEdges.svg)

    for (const node of data.nodes.values()) {
      const card = document.createElement(
        node.type === "group" ? "div" : "article"
      )
      card.className = `node ${node.type === "group" ? "group" : "card card-" + node.type}`
      card.dataset.nodeId = node.id
      card.tabIndex = 0
      card.setAttribute("aria-label", t(node.type))
      card.style.left = node.x + "px"
      card.style.top = node.y + "px"
      card.style.width = node.width + "px"
      card.style.height = node.height + "px"
      if (node.color) card.style.setProperty("--node-color", node.color)
      switch (node.type) {
        case "text":
          card.classList.add("markdown")
          content.renderMarkdown(card, node.text, path)
          break
        case "link":
          content.renderLink(card, node.url)
          break
        case "file":
          visibleAssets.set(card, () => void content.renderFile(card, node))
          break
        case "group": {
          const title = document.createElement("span")
          title.className = "group-name"
          title.textContent = node.label || t("group")
          card.append(title)
          const { background, backgroundStyle } = node
          if (background)
            visibleAssets.set(
              card,
              () =>
                void content.renderGroupBackground(
                  card,
                  background,
                  backgroundStyle
                )
            )
          break
        }
      }
      fragment.append(card)
    }
    sceneArt.replaceChildren(fragment)
    controls.setBounds(canvasBounds(data))
    if (!visibleAssets.size) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (signal.aborted) return
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          observer.unobserve(entry.target)
          visibleAssets.get(entry.target)?.()
          visibleAssets.delete(entry.target)
        }
      },
      { root: viewport, rootMargin: "120px" }
    )
    for (const card of visibleAssets.keys()) observer.observe(card)
    signal.addEventListener("abort", () => observer.disconnect(), {
      once: true,
    })
  }

  function show(next: TextSnapshot, redraw = false) {
    if (ctx.signal.aborted) return
    const previous = snapshot
    snapshot = next
    if (redraw || previous?.text !== next.text || state === "error") {
      try {
        model = parseCanvas(next.text)
        draw(model)
      } catch {
        model = undefined
        state = "error"
        refreshEditor()
        setStatus("invalid")
        return
      }
    }
    if (!model) return
    state = model.nodes.size ? "ready" : "empty"
    refreshEditor()
    setStatus(
      next.conflicted ? "conflict" : state === "empty" ? "empty" : "",
      model.skipped
    )
  }

  async function writeGeometry(geometry: ReadonlyMap<string, Rect>) {
    if (!snapshot || ctx.signal.aborted) return false
    const changes: CanvasChange[] = Array.from(geometry, ([id, rect]) => ({
      collection: "nodes",
      id,
      operation: "update",
      patch: { ...rect },
    }))
    try {
      const text = changeCanvas(snapshot.text, changes)
      const result = await workingCopy.edit({
        text,
        expectedVersion: snapshot.version,
        label: t("edit"),
      })
      if (ctx.signal.aborted) return false
      if (result.status === "stale") {
        show(result.snapshot, true)
        setStatus("stale", model?.skipped ?? 0)
        return false
      }
      // The local model and its card elements already contain this geometry.
      snapshot = result.snapshot
      setStatus(snapshot.conflicted ? "conflict" : "", model?.skipped ?? 0)
      return true
    } catch {
      if (!ctx.signal.aborted) {
        const latest = await workingCopy.read().catch(() => snapshot)
        if (latest) show(latest, true)
        setStatus("edit.error", model?.skipped ?? 0)
      }
      return false
    }
  }

  async function refreshDocument() {
    if (
      !invalidated ||
      refreshing ||
      busy ||
      geometryWrites.running ||
      ctx.signal.aborted
    )
      return
    const basis = snapshot
    invalidated = false
    refreshing = true
    try {
      const latest = await workingCopy.read()
      if (snapshot !== basis || busy || geometryWrites.running)
        invalidated = true
      else if (state === "error" || !sameSnapshot(snapshot, latest))
        show(latest)
    } catch {
      if (!ctx.signal.aborted) setStatus("read.error", model?.skipped ?? 0)
    } finally {
      refreshing = false
      if (invalidated) void refreshDocument()
    }
  }

  async function perform(
    operation: (current: TextSnapshot) => Promise<boolean>
  ) {
    if (!snapshot || busy || ctx.signal.aborted) return false
    busy = true
    refreshEditor()
    try {
      const queued = geometryWrites.running
      if (queued && !(await queued)) return false
      if (ctx.signal.aborted) return false
      return await operation(snapshot)
    } catch {
      if (!ctx.signal.aborted) setStatus("edit.error", model?.skipped ?? 0)
      return false
    } finally {
      busy = false
      if (!ctx.signal.aborted) {
        refreshEditor()
        void refreshDocument()
      }
    }
  }

  async function load() {
    if (ctx.signal.aborted) return
    if (observing) {
      try {
        show(await workingCopy.read())
      } catch {
        if (!ctx.signal.aborted) setStatus("read.error")
      }
      return
    }
    observing = true
    let registered = false
    const spinner = window.setTimeout(() => {
      if (!snapshot && !ctx.signal.aborted) setStatus("loading")
    }, 180)
    try {
      const initial = notifications
      const observation = await workingCopy.observe(
        (next) => {
          notifications++
          if (sameSnapshot(snapshot, next)) return
          // Observer notifications can arrive after a more recent edit response.
          invalidated = true
          void refreshDocument()
        },
        () => {
          observing = false
          if (!ctx.signal.aborted) {
            state = "error"
            setStatus("read.error")
          }
        }
      )
      if (ctx.signal.aborted) observation.subscription.dispose()
      else {
        registered = true
        ctx.subscriptions.add(observation.subscription)
        if (initial === notifications) show(observation.snapshot)
      }
    } catch {
      if (!ctx.signal.aborted) {
        state = "error"
        setStatus("read.error")
      }
    } finally {
      if (!registered) observing = false
      window.clearTimeout(spinner)
    }
  }

  updateLabels()
  refreshEditor()
  if (ctx.presentation?.mode === "standalone")
    viewport.focus({ preventScroll: true })
  const refreshFiles = () => renderedContent?.refreshFiles()
  window.addEventListener("focus", refreshFiles, { signal: ctx.signal })
  void fs
    .watch("", refreshFiles)
    .then((subscription) => {
      if (ctx.signal.aborted) subscription.dispose()
      else {
        ctx.subscriptions.add(subscription)
        refreshFiles()
      }
    })
    .catch(() => {})
  void load()
}

export default mount
