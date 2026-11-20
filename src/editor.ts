import type {
  Canvas,
  CanvasChange,
  CanvasEdge,
  CanvasNode,
  Point,
  Rect,
  ResizeCorner,
} from "./canvas"
import { canvasColors, edgeGeometry, resizeNode } from "./canvas"
import { draggedMarkdownPaths, isSpaceFileDrag } from "./drag-files"
import { icon } from "./icons"
import { resolveSpacePath } from "./paths"
import { labelToolbarButton } from "./toolbar-label"

type Kind = CanvasNode["type"]
type Selection = { collection: CanvasChange["collection"]; id: string }
type Translator = (key: string) => string
type Tool = { kind: Kind } | { kind: "connect"; from: string }
type InlineField = "text" | "file" | "url" | "label"

interface Operations {
  edit(change: CanvasChange | CanvasChange[]): Promise<boolean>
  commitGeometry(id: string, rect: Rect): boolean
  save(): Promise<void>
  history(direction: "undo" | "redo"): Promise<void>
  status(key: string): void
  previewNode(id: string, rect: Rect): void
  fileExists(path: string): Promise<boolean>
}

interface Viewport {
  scale(): number
  toCanvas(point: Point): Point
  keepPosition(): void
}

const sides = ["", "top", "right", "bottom", "left"]
const kinds: Kind[] = ["text", "file", "link", "group"]
const resizeCorners: ResizeCorner[] = ["nw", "ne", "sw", "se"]
const insertKeys: Record<Kind, string> = {
  text: "t",
  file: "f",
  link: "l",
  group: "g",
}
const sizes: Record<Kind, [number, number]> = {
  text: [300, 180],
  file: [320, 220],
  link: [300, 96],
  group: [450, 300],
}

function action(label: string, handler: () => void, signal: AbortSignal) {
  const button = document.createElement("button")
  button.type = "button"
  button.textContent = label
  button.addEventListener("click", handler, { signal })
  return button
}

interface EditorForm {
  element: HTMLFormElement
  submit: HTMLButtonElement
  changed(): boolean
  change(): CanvasChange | undefined
  focus(): void
}

function createForm(
  item: CanvasNode | CanvasEdge,
  selection: Selection,
  t: Translator,
  signal: AbortSignal,
  onClose: () => void
): EditorForm {
  const element = document.createElement("form")
  element.className = "canvas-form"
  const kind = "type" in item ? item.type : "edge"
  const caption = document.createElement("strong")
  caption.textContent = t(kind)
  const header = document.createElement("header")
  const close = action("×", onClose, signal)
  close.title = t("close")
  close.setAttribute("aria-label", t("close"))
  header.append(caption, close)
  element.append(header)
  const fields = document.createElement("div")
  fields.className = "form-fields"
  element.append(fields)
  const values: Array<() => [key: string, value: unknown, changed: boolean]> =
    []
  const data: Record<string, unknown> = { ...item }
  let firstField: HTMLElement | undefined

  function field(
    key: string,
    label: string,
    config: {
      input?: "textarea" | "number" | "checkbox"
      options?: Array<{ id: string; label: string }>
      required?: boolean
      minimum?: number
      pattern?: string
      placeholder?: string
    } = {},
    parent = fields
  ) {
    const wrapper = document.createElement("label")
    const title = document.createElement("span")
    title.textContent = t(label)
    const previous = String(data[key] ?? "")
    let control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    if (config.options) {
      const select = document.createElement("select")
      for (const choice of config.options)
        select.add(new Option(choice.label, choice.id))
      select.value = previous
      if (select.selectedIndex < 0) select.selectedIndex = 0
      control = select
    } else if (config.input === "textarea") {
      const area = document.createElement("textarea")
      area.rows = 6
      area.value = previous
      control = area
    } else {
      const input = document.createElement("input")
      input.type = config.input ?? "text"
      input.value = previous
      if (config.input === "number") {
        input.min = String(config.minimum ?? -Number.MAX_SAFE_INTEGER)
        input.max = String(Number.MAX_SAFE_INTEGER)
      }
      if (config.pattern) input.pattern = config.pattern
      if (config.placeholder) input.placeholder = t(config.placeholder)
      if (config.input === "checkbox") {
        input.checked = previous === "arrow"
        wrapper.className = "check-field"
      }
      control = input
    }
    control.required = config.required ?? false
    const before = control.value
    values.push(() => {
      if (control instanceof HTMLInputElement && config.input === "checkbox") {
        const value = control.checked ? "arrow" : "none"
        return [key, value, value !== previous]
      }
      const value =
        config.input === "number"
          ? Number(control.value)
          : control.value || (key === "text" ? "" : undefined)
      return [key, value, before !== control.value]
    })
    wrapper.append(title, control)
    parent.append(wrapper)
    firstField ??= control
  }

  const optionList = (items: string[]) =>
    items.map((id) => ({ id, label: t(id || "auto") }))
  if (kind === "text") field("text", "markdown", { input: "textarea" })
  if (kind === "file") {
    field("file", "path", { required: true })
    field("subpath", "subpath", { pattern: "#.*" })
  }
  if (kind === "link") field("url", "url", { required: true })
  if (kind === "group") {
    field("label", "label")
    field("background", "background")
    field("backgroundStyle", "background.style", {
      options: optionList(["", "cover", "ratio", "repeat"]),
    })
  }
  if (kind === "edge") {
    field("label", "label")
    field("fromSide", "edge.from", { options: optionList(sides) })
    field("toSide", "edge.to", { options: optionList(sides) })
    const arrows = document.createElement("div")
    arrows.className = "form-grid"
    fields.append(arrows)
    field("fromEnd", "edge.arrow.start", { input: "checkbox" }, arrows)
    field("toEnd", "edge.arrow.end", { input: "checkbox" }, arrows)
  } else {
    const dimensions = document.createElement("div")
    dimensions.className = "form-grid"
    fields.append(dimensions)
    for (const key of ["x", "y", "width", "height"]) {
      field(
        key,
        key,
        {
          input: "number",
          required: true,
          minimum: key === "x" || key === "y" ? undefined : 1,
        },
        dimensions
      )
    }
  }
  field("color", "color", {
    pattern:
      "[1-6]|#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})",
    placeholder: "color.hint",
  })
  const footer = document.createElement("footer")
  const submit = document.createElement("button")
  submit.type = "button"
  submit.textContent = t("apply")
  footer.append(submit)
  element.append(footer)
  return {
    element,
    submit,
    changed: () => values.some((value) => value()[2]),
    change() {
      if (!element.reportValidity()) return
      const patch: Record<string, unknown> = {}
      for (const read of values) {
        const [key, value, changed] = read()
        if (changed) patch[key] = value
      }
      return { ...selection, operation: "update", patch }
    },
    focus: () => firstField?.focus({ preventScroll: true }),
  }
}

export function createEditor(
  scene: HTMLElement,
  view: Viewport,
  t: Translator,
  operations: Operations,
  signal: AbortSignal
) {
  let canvas: Canvas | undefined
  let selection: Selection | undefined
  let pending = false
  let saveConflict = false
  let form: EditorForm | undefined
  let formScope: AbortController | undefined
  let formCanvas: Canvas | undefined
  let tool: Tool | undefined
  let inline: { commit(): Promise<boolean>; close(): void } | undefined
  let groupDrag: { pointer: number; start: Point } | undefined
  let checkingDrop = false
  let suppressPlacementClick = false
  let saveAfterDrag = false
  let relinkTarget: HTMLElement | undefined
  let drag:
    | {
        card: HTMLElement
        node: CanvasNode
        model?: Canvas
        pointer: number
        capture: Element
        started: boolean
        x: number
        y: number
        rect: Rect
        corner?: ResizeCorner
      }
    | undefined
  let suppressClick = false

  const viewport = scene.parentElement!
  const toolHint = document.createElement("div")
  toolHint.className = "tool-hint"
  toolHint.setAttribute("role", "status")
  toolHint.hidden = true
  const groupPreview = document.createElement("div")
  groupPreview.className = "group-preview"
  groupPreview.hidden = true
  const resizeFrame = document.createElement("div")
  resizeFrame.className = "resize-frame"
  resizeFrame.hidden = true
  resizeFrame.setAttribute("aria-hidden", "true")
  for (const corner of resizeCorners) {
    const handle = document.createElement("span")
    handle.dataset.resizeCorner = corner
    resizeFrame.append(handle)
  }
  scene.append(groupPreview, resizeFrame)
  const inspector = document.createElement("aside")
  inspector.className = "inspector"
  inspector.hidden = true
  const menu = document.createElement("div")
  menu.className = "canvas-menu"
  menu.setAttribute("role", "menu")
  menu.hidden = true
  let menuScope: AbortController | undefined
  let menuAnchor: HTMLElement | SVGElement | undefined
  const history = document.createElement("div")
  history.className = "edit-history"
  const undo = action("", () => changeHistory("undo"), signal)
  const redo = action("", () => changeHistory("redo"), signal)
  undo.append(icon("undo"))
  redo.append(icon("redo"))
  undo.setAttribute("aria-keyshortcuts", "Meta+Z Control+Z")
  redo.setAttribute(
    "aria-keyshortcuts",
    "Meta+Shift+Z Control+Shift+Z Control+Y"
  )
  history.append(undo, redo)

  const tools = document.createElement("div")
  tools.className = "canvas-tools"
  function toolButton(
    name: "select" | Kind | "connect" | "color",
    run: () => void,
    key?: string
  ) {
    const button = action("", run, signal)
    button.append(icon(name))
    if (key) button.setAttribute("aria-keyshortcuts", key)
    tools.append(button)
    return button
  }
  const selectTool = toolButton(
    "select",
    () => {
      setTool()
      viewport.focus({ preventScroll: true })
    },
    "Escape"
  )
  const insertTools = kinds.map(
    (kind) =>
      [
        kind,
        toolButton(kind, () => addNode(kind), insertKeys[kind].toUpperCase()),
      ] as const
  )
  const connectTool = toolButton("connect", connectSelection, "C")
  const colorMenu = document.createElement("div")
  colorMenu.className = "card-colors"
  colorMenu.hidden = true
  colorMenu.setAttribute("role", "group")
  const colorTool = toolButton("color", () => {
    if (!colorMenu.hidden) closeColors()
    else {
      colorMenu.hidden = false
      colorTool.setAttribute("aria-expanded", "true")
      const current = colorMenu.querySelector<HTMLButtonElement>(
        "[aria-pressed=true]"
      )
      const focusedSwatch = current ?? colors[0].button
      focusedSwatch.focus({ preventScroll: true })
    }
  })
  colorTool.setAttribute("aria-expanded", "false")
  const colors = [["", ""], ...Object.entries(canvasColors)].map(
    ([value, color]) => {
      const button = action(
        "",
        () => {
          const item = selectedItem()
          closeColors(true)
          if (
            !item ||
            !("type" in item) ||
            item.color === (color || undefined) ||
            pending
          )
            return
          void operations.edit({
            collection: "nodes",
            id: item.id,
            operation: "update",
            patch: { color: value || undefined },
          })
        },
        signal
      )
      button.className = "color-swatch"
      button.style.setProperty("--swatch", color || "var(--card-paper)")
      colorMenu.append(button)
      return {
        color,
        button,
        label: value ? `color.${value}` : "color.default",
      }
    }
  )
  tools.append(colorMenu)

  function closeColors(restoreFocus = false) {
    if (colorMenu.hidden) return
    colorMenu.hidden = true
    colorTool.setAttribute("aria-expanded", "false")
    if (restoreFocus) colorTool.focus({ preventScroll: true })
  }

  function updateTools() {
    const item = selectedItem()
    const node = item && "type" in item ? item : undefined
    const editable = !!canvas && !pending && !form && !inline
    selectTool.setAttribute("aria-pressed", String(!tool))
    for (const [kind, button] of insertTools) {
      button.disabled = !editable
      button.setAttribute("aria-pressed", String(tool?.kind === kind))
    }
    connectTool.disabled = !editable || !node
    connectTool.setAttribute("aria-pressed", String(tool?.kind === "connect"))
    colorTool.disabled = !editable || !node || !!tool
    for (const { color, button } of colors)
      button.setAttribute(
        "aria-pressed",
        String(!!node && (node.color ?? "") === color)
      )
    if (colorTool.disabled) closeColors()
  }

  function updateLabels() {
    const labels: ReadonlyArray<readonly [HTMLButtonElement, string]> = [
      [undo, "undo"],
      [redo, "redo"],
      [selectTool, "select"],
      ...insertTools.map(([kind, button]) => [button, kind] as const),
      [connectTool, "connect"],
      [colorTool, "color"],
    ]
    for (const [button, key] of labels) labelToolbarButton(button, t(key))
    for (const { button, label } of colors) {
      button.setAttribute("aria-label", t(label))
      button.title = t(label)
    }
    colorMenu.setAttribute("aria-label", t("color"))
    toolHint.textContent = tool ? t("tool." + tool.kind) : ""
  }

  function setTool(next?: Tool) {
    tool = next
    groupDrag = undefined
    groupPreview.hidden = true
    toolHint.hidden = !next
    toolHint.textContent = next ? t("tool." + next.kind) : ""
    viewport.classList.toggle("placing", !!next)
    reflectSelection()
    if (next) viewport.focus({ preventScroll: true })
  }

  function selectedItem() {
    if (!selection) return
    return selection.collection === "nodes"
      ? canvas?.nodes.get(selection.id)
      : canvas?.edges.find((edge) => edge.id === selection?.id)
  }

  function reflectSelection() {
    const item = selectedItem()
    scene.querySelector(".selected")?.classList.remove("selected")
    const box =
      item && "type" in item && !tool && !form && !inline ? item : undefined
    resizeFrame.hidden = !box
    if (box) placeBox(resizeFrame, box)
    updateTools()
    if (!item) return
    const group = selection?.collection === "nodes" ? "node" : "edge"
    scene
      .querySelector(`[data-${group}-id="${CSS.escape(item.id)}"]`)
      ?.classList.add("selected")
  }

  function closeForm() {
    formScope?.abort()
    formScope = undefined
    form = undefined
    formCanvas = undefined
    inspector.hidden = true
    inspector.replaceChildren()
    reflectSelection()
    viewport.focus({ preventScroll: true })
  }

  function openProperties() {
    const item = selectedItem()
    if (!selection || !item) return
    if (inline || form || pending) {
      operations.status("pending.edit")
      return
    }
    setTool()
    closeMenu()
    formScope = new AbortController()
    formCanvas = canvas
    const lifetime = AbortSignal.any([formScope.signal, signal])
    form = createForm(item, selection, t, lifetime, closeForm)
    form.submit.addEventListener("click", () => void applyForm(), {
      signal: lifetime,
    })
    form.element.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key !== "Enter" ||
          event.isComposing ||
          !(event.target instanceof HTMLInputElement) ||
          event.target.type === "checkbox"
        )
          return
        event.preventDefault()
        void applyForm()
      },
      { signal: lifetime }
    )
    inspector.replaceChildren(form.element)
    inspector.hidden = false
    reflectSelection()
    form.focus()
  }

  async function applyForm() {
    if (!form) return true
    if (pending) return false
    if (formCanvas !== canvas) {
      formCanvas = canvas
      operations.status("stale")
      return false
    }
    const change = form.change()
    if (!change) return false
    if (change.operation === "update" && !Object.keys(change.patch).length) {
      closeForm()
      return true
    }
    if (!(await operations.edit(change))) return false
    selection = { collection: change.collection, id: change.id }
    closeForm()
    return true
  }

  function editSelection() {
    const item = selectedItem()
    const target = selection
    if (!item || !target || !canvas) return
    if ("type" in item) {
      const field =
        item.type === "link"
          ? "url"
          : item.type === "group"
            ? "label"
            : item.type
      const value =
        item.type === "link"
          ? item.url
          : item.type === "group"
            ? (item.label ?? "")
            : item.type === "text"
              ? item.text
              : item.file
      const box =
        item.type === "group"
          ? { ...item, width: Math.min(item.width, 260), height: 36 }
          : item
      startInline(box, field, value, (next) => ({
        ...target,
        operation: "update",
        patch: { [field]: next },
      }))
      return
    }
    const from = canvas.nodes.get(item.fromNode)
    const to = canvas.nodes.get(item.toNode)
    if (!from || !to) return
    const { label } = edgeGeometry(item, from, to)
    startInline(
      { x: label.x - 90, y: label.y - 18, width: 180, height: 36 },
      "label",
      item.label ?? "",
      (next) => ({
        ...target,
        operation: "update",
        patch: { label: next || undefined },
      })
    )
  }

  function relinkFile(id: string) {
    if (pending || inline || form || canvas?.nodes.get(id)?.type !== "file")
      return
    if (select({ collection: "nodes", id })) editSelection()
  }

  function deleteSelection() {
    if (selection && selectedItem() && !inline && !form && !pending)
      void operations.edit({ ...selection, operation: "delete" })
  }

  function connectSelection() {
    if (
      !canvas ||
      !selection ||
      selection.collection !== "nodes" ||
      !selectedItem() ||
      inline ||
      form ||
      pending
    )
      return
    setTool({ kind: "connect", from: selection.id })
  }

  function placeBox(element: HTMLElement, rect: Rect) {
    element.style.left = rect.x + "px"
    element.style.top = rect.y + "px"
    element.style.width = rect.width + "px"
    element.style.height = rect.height + "px"
  }

  function startInline(
    rect: Rect,
    field: InlineField,
    value: string,
    change: (next: string) => CanvasChange,
    newCard = false
  ) {
    if (inline || form || pending) return
    setTool()
    closeMenu()
    const container = document.createElement("div")
    container.className = "inline-draft"
    placeBox(container, rect)
    const input = document.createElement(
      field === "text" ? "textarea" : "input"
    )
    const label = t(
      field === "text" ? "markdown" : field === "file" ? "path" : field
    )
    input.setAttribute("aria-label", label)
    input.placeholder = label
    input.value = value
    container.append(input)
    scene.append(container)
    const scope = new AbortController()
    const lifetime = AbortSignal.any([scope.signal, signal])
    let basis = canvas
    let saving: Promise<boolean> | undefined

    function close() {
      inline = undefined
      scope.abort()
      container.remove()
      reflectSelection()
      if (document.activeElement === document.body)
        viewport.focus({ preventScroll: true })
    }

    async function apply() {
      if (pending || signal.aborted) return false
      const typed = input.value
      if ((!typed.trim() && newCard) || (typed === value && !newCard)) {
        close()
        return true
      }
      let next = field === "text" ? typed : typed.trim()
      if (field === "file") {
        const path = resolveSpacePath(next)
        if (!path || !(await operations.fileExists(path))) {
          if (!lifetime.aborted) {
            operations.status("file.missing")
            input.focus({ preventScroll: true })
          }
          return false
        }
        next = path
      }
      if (field === "url") {
        try {
          next = new URL(/^[\w+.-]+:/.test(next) ? next : "https://" + next)
            .href
        } catch {
          operations.status("link.invalid")
          input.focus({ preventScroll: true })
          return false
        }
      }
      if (lifetime.aborted) return false
      if (basis !== canvas) {
        basis = canvas
        operations.status("stale")
        input.focus({ preventScroll: true })
        return false
      }
      const edit = change(next)
      if (newCard) view.keepPosition()
      if (!(await operations.edit(edit))) {
        if (!lifetime.aborted) {
          basis = canvas
          input.focus({ preventScroll: true })
        }
        return false
      }
      selection = { collection: edit.collection, id: edit.id }
      close()
      reflectSelection()
      return true
    }

    const commit = () =>
      (saving ??= apply().finally(() => {
        saving = undefined
      }))
    inline = { commit, close }
    reflectSelection()
    input.addEventListener("blur", () => void commit(), { signal: lifetime })
    input.addEventListener(
      "keydown",
      (event) => {
        if (
          !(event instanceof KeyboardEvent) ||
          event.key !== "Enter" ||
          event.isComposing
        )
          return
        if (field === "text" && !event.metaKey && !event.ctrlKey) return
        event.preventDefault()
        void commit()
      },
      { signal: lifetime }
    )
    input.focus({ preventScroll: true })
    if (field !== "text") input.select()
  }

  function addNode(kind: Kind) {
    if (!canvas || inline || form || pending) return
    setTool({ kind })
  }

  function nodeChange(
    type: Kind,
    rect: Rect,
    content: Record<string, unknown> = {}
  ): CanvasChange {
    return {
      collection: "nodes",
      id: crypto.randomUUID(),
      operation: "add",
      patch: { type, ...rect, ...content },
    }
  }

  async function insert(changes: CanvasChange[]) {
    if (!changes.length || !canvas || pending || signal.aborted) return
    view.keepPosition()
    const first = changes[0]
    if (await operations.edit(changes.length === 1 ? first : changes)) {
      selection = { collection: first.collection, id: first.id }
      reflectSelection()
      viewport.focus({ preventScroll: true })
    }
  }

  async function saveDocument() {
    if (drag) {
      saveAfterDrag = true
      return
    }
    if (
      saveConflict ||
      (inline && !(await inline.commit())) ||
      pending ||
      !(await applyForm())
    )
      return
    await operations.save()
  }

  function changeHistory(direction: "undo" | "redo") {
    if (inline || form) {
      operations.status("pending.edit")
      return
    }
    if (!pending) void operations.history(direction)
  }

  function select(target?: Selection) {
    if (form?.changed()) {
      operations.status("pending.edit")
      return false
    }
    if (form) closeForm()
    selection = target
    reflectSelection()
    return true
  }

  function selectionAt(element: Element) {
    const node = element.closest<HTMLElement>("[data-node-id]")
    if (node?.dataset.nodeId !== undefined)
      return {
        element: node,
        selection: {
          collection: "nodes",
          id: node.dataset.nodeId,
        } as Selection,
      }
    const edge = element.closest<SVGGElement>("[data-edge-id]")
    if (edge?.dataset.edgeId !== undefined)
      return {
        element: edge,
        selection: {
          collection: "edges",
          id: edge.dataset.edgeId,
        } as Selection,
      }
  }

  function closeMenu(restoreFocus = false) {
    if (menu.hidden) return
    menuScope?.abort()
    menuScope = undefined
    menu.hidden = true
    menu.replaceChildren()
    if (restoreFocus)
      (menuAnchor?.isConnected ? menuAnchor : viewport).focus({
        preventScroll: true,
      })
    menuAnchor = undefined
  }

  function showMenu(point: Point, target?: ReturnType<typeof selectionAt>) {
    if (!canvas || pending) return
    if (inline || form) {
      operations.status("pending.edit")
      return
    }
    setTool()
    closeMenu()
    menuScope = new AbortController()
    menuAnchor = target?.element ?? viewport
    const lifetime = AbortSignal.any([signal, menuScope.signal])
    const items: HTMLButtonElement[] = []
    const addItem = (label: string, run: () => void, shortcut?: string) => {
      const item = action(
        t(label),
        () => {
          closeMenu(true)
          run()
        },
        lifetime
      )
      item.setAttribute("role", "menuitem")
      if (shortcut) {
        item.setAttribute("aria-keyshortcuts", shortcut)
        const hint = document.createElement("kbd")
        hint.textContent = shortcut
        hint.setAttribute("aria-hidden", "true")
        item.append(hint)
      }
      items.push(item)
    }
    if (target) {
      select(target.selection)
      menu.setAttribute("aria-label", t("item.menu"))
      addItem("edit", editSelection, "Enter")
      if (target.selection.collection === "nodes")
        addItem("connect", connectSelection, "C")
      addItem("properties", openProperties)
      addItem("delete", deleteSelection, "Delete")
    } else {
      menu.setAttribute("aria-label", t("insert"))
      for (const kind of kinds)
        addItem(kind, () => addNode(kind), insertKeys[kind].toUpperCase())
    }
    menu.replaceChildren(...items)
    menu.hidden = false
    const frame = viewport.getBoundingClientRect()
    menu.style.left =
      Math.max(
        4,
        Math.min(point.x - frame.left, frame.width - menu.offsetWidth - 4)
      ) + "px"
    menu.style.top =
      Math.max(
        4,
        Math.min(point.y - frame.top, frame.height - menu.offsetHeight - 4)
      ) + "px"
    items[0]?.focus({ preventScroll: true })
    menu.addEventListener(
      "keydown",
      (event) => {
        const current = items.findIndex((item) => item === event.target)
        let next: number
        switch (event.key) {
          case "ArrowDown":
            next = (current + 1) % items.length
            break
          case "ArrowUp":
            next = (current - 1 + items.length) % items.length
            break
          case "Home":
            next = 0
            break
          case "End":
            next = items.length - 1
            break
          case "Tab":
            closeMenu()
            return
          default:
            return
        }
        event.preventDefault()
        items[next]?.focus({ preventScroll: true })
      },
      { signal: lifetime }
    )
  }

  viewport.addEventListener(
    "contextmenu",
    (event) => {
      if (!(event.target instanceof Element)) return
      if (event.target.closest("input, textarea, select, video, audio")) return
      event.preventDefault()
      showMenu(
        { x: event.clientX, y: event.clientY },
        selectionAt(event.target)
      )
    },
    { signal }
  )
  window.addEventListener(
    "pointerdown",
    (event) => {
      if (!(event.target instanceof Node)) return
      if (!menu.contains(event.target)) closeMenu()
      if (
        !colorMenu.contains(event.target) &&
        !colorTool.contains(event.target)
      )
        closeColors()
    },
    { signal, capture: true }
  )
  window.addEventListener("resize", () => closeMenu(), { signal })

  function isFileDrag(event: DragEvent) {
    return !!event.dataTransfer && isSpaceFileDrag(event.dataTransfer)
  }

  function missingFileCard(target: EventTarget | null) {
    return target instanceof Element
      ? (target.closest<HTMLElement>("[data-file-missing][data-node-id]") ??
          undefined)
      : undefined
  }

  function markFileDrop(active: boolean, target?: HTMLElement) {
    viewport.classList.toggle("file-over", active)
    if (relinkTarget === target) return
    relinkTarget?.classList.remove("relink-over")
    relinkTarget = target
    relinkTarget?.classList.add("relink-over")
  }

  viewport.addEventListener(
    "dragover",
    (event) => {
      const transfer = event.dataTransfer
      if (
        !canvas ||
        pending ||
        form ||
        inline ||
        !transfer ||
        !isFileDrag(event)
      )
        return
      event.preventDefault()
      transfer.dropEffect = "copy"
      markFileDrop(true, missingFileCard(event.target))
    },
    { signal }
  )
  viewport.addEventListener(
    "dragleave",
    (event) => {
      if (
        !(
          event.relatedTarget instanceof Node &&
          viewport.contains(event.relatedTarget)
        )
      )
        markFileDrop(false)
    },
    { signal }
  )
  window.addEventListener("dragend", () => markFileDrop(false), { signal })
  viewport.addEventListener(
    "drop",
    (event) => {
      markFileDrop(false)
      if (
        !canvas ||
        pending ||
        form ||
        inline ||
        checkingDrop ||
        !event.dataTransfer ||
        !isFileDrag(event)
      )
        return
      event.preventDefault()
      const paths = draggedMarkdownPaths(event.dataTransfer)
      if (!paths.length) return
      const target = missingFileCard(event.target)
      const relinkId = target?.dataset.nodeId
      if (relinkId !== undefined && paths.length !== 1) {
        operations.status("file.relink.single")
        return
      }
      const point = view.toCanvas({ x: event.clientX, y: event.clientY })
      const [width, height] = sizes.file
      checkingDrop = true
      void (async () => {
        try {
          const available: string[] = []
          for (
            let offset = 0;
            offset < paths.length && !signal.aborted;
            offset += 16
          ) {
            const batch = paths.slice(offset, offset + 16)
            const exists = await Promise.all(
              batch.map((path) => operations.fileExists(path))
            )
            available.push(...batch.filter((_, index) => exists[index]))
          }
          if (signal.aborted || pending || form || inline) return
          if (!available.length) {
            operations.status("file.missing")
            return
          }
          closeMenu()
          setTool()
          if (target && relinkId !== undefined) {
            if (
              !target.isConnected ||
              !target.hasAttribute("data-file-missing") ||
              canvas?.nodes.get(relinkId)?.type !== "file"
            ) {
              operations.status("stale")
              return
            }
            await insert([
              {
                collection: "nodes",
                id: relinkId,
                operation: "update",
                patch: { file: available[0] },
              },
            ])
            return
          }
          await insert(
            available.map((file, index) =>
              nodeChange(
                "file",
                {
                  x: point.x - width / 2 + index * (width + 24),
                  y: point.y - height / 2,
                  width,
                  height,
                },
                { file }
              )
            )
          )
        } finally {
          checkingDrop = false
        }
      })()
    },
    { signal }
  )

  function groupRect(start: Point, end: Point): Rect {
    return {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    }
  }

  viewport.addEventListener(
    "pointerdown",
    (event) => {
      if (
        !tool ||
        pending ||
        event.button !== 0 ||
        !event.isPrimary ||
        viewport.classList.contains("space-held")
      )
        return
      event.preventDefault()
      event.stopImmediatePropagation()
      suppressPlacementClick = true
      const point = view.toCanvas({ x: event.clientX, y: event.clientY })
      const active = tool
      const { kind } = active
      if (kind === "connect") {
        const target =
          event.target instanceof Element
            ? selectionAt(event.target)
            : undefined
        const from = active.from
        if (
          target?.selection.collection === "nodes" &&
          canvas?.nodes.has(from)
        ) {
          setTool()
          void insert([
            {
              collection: "edges",
              id: crypto.randomUUID(),
              operation: "add",
              patch: { fromNode: from, toNode: target.selection.id },
            },
          ])
        }
        return
      }
      if (kind === "group") {
        viewport.setPointerCapture(event.pointerId)
        groupDrag = { pointer: event.pointerId, start: point }
        placeBox(groupPreview, { ...point, width: 1, height: 1 })
        groupPreview.hidden = false
        return
      }
      const [width, height] = sizes[kind]
      const rect = { ...point, width, height }
      const field = kind === "link" ? "url" : kind
      startInline(
        rect,
        field,
        "",
        (next) => nodeChange(kind, rect, { [field]: next }),
        true
      )
    },
    { signal, capture: true }
  )
  viewport.addEventListener(
    "pointermove",
    (event) => {
      if (groupDrag?.pointer !== event.pointerId) return
      placeBox(
        groupPreview,
        groupRect(
          groupDrag.start,
          view.toCanvas({ x: event.clientX, y: event.clientY })
        )
      )
    },
    { signal }
  )
  viewport.addEventListener(
    "pointerup",
    (event) => {
      if (suppressPlacementClick)
        window.setTimeout(() => {
          suppressPlacementClick = false
        }, 0)
      if (groupDrag?.pointer !== event.pointerId) return
      const start = groupDrag.start
      const rect = groupRect(
        start,
        view.toCanvas({ x: event.clientX, y: event.clientY })
      )
      setTool()
      const [width, height] = sizes.group
      const box =
        rect.width < 8 && rect.height < 8
          ? { ...start, width, height }
          : {
              ...rect,
              width: Math.max(48, rect.width),
              height: Math.max(48, rect.height),
            }
      void insert([nodeChange("group", box)])
    },
    { signal }
  )
  for (const event of ["pointercancel", "lostpointercapture"] as const) {
    viewport.addEventListener(
      event,
      () => {
        suppressPlacementClick = false
        if (groupDrag) setTool()
      },
      { signal }
    )
  }
  viewport.addEventListener(
    "click",
    (event) => {
      if (!suppressPlacementClick && !suppressClick) return
      suppressPlacementClick = false
      event.preventDefault()
      event.stopImmediatePropagation()
    },
    { signal, capture: true }
  )

  viewport.addEventListener(
    "click",
    (event) => {
      if (!inline && event.target === viewport && select())
        viewport.focus({ preventScroll: true })
    },
    { signal }
  )

  scene.addEventListener(
    "dblclick",
    (event) => {
      if (
        suppressClick ||
        !(event.target instanceof Element) ||
        event.target.closest(
          "button, input, audio, video, [data-resize-corner]"
        )
      )
        return
      const target = selectionAt(event.target)
      if (target && !tool && !inline && !form && select(target.selection))
        editSelection()
    },
    { signal }
  )

  scene.addEventListener(
    "pointerdown",
    (event) => {
      if (
        pending ||
        inline ||
        drag ||
        event.button !== 0 ||
        !event.isPrimary ||
        viewport.classList.contains("space-held") ||
        !(event.target instanceof Element) ||
        event.target.closest("button, input, audio, video")
      )
        return
      const edge = event.target.closest<SVGGElement>("[data-edge-id]")
      if (edge?.dataset.edgeId !== undefined) {
        event.stopPropagation()
        select({ collection: "edges", id: edge.dataset.edgeId })
        return
      }
      const corner = event.target.closest<HTMLElement>("[data-resize-corner]")
        ?.dataset.resizeCorner as ResizeCorner | undefined
      const card = corner
        ? scene.querySelector<HTMLElement>(".node.selected")
        : event.target.closest<HTMLElement>("[data-node-id]")
      const node =
        card?.dataset.nodeId !== undefined
          ? canvas?.nodes.get(card.dataset.nodeId)
          : undefined
      if (!card || !node || !select({ collection: "nodes", id: node.id }))
        return
      event.preventDefault()
      event.stopPropagation()
      card.focus({ preventScroll: true })
      const capture = corner ? resizeFrame : card
      capture.setPointerCapture(event.pointerId)
      drag = {
        card,
        node,
        model: canvas,
        pointer: event.pointerId,
        capture,
        started: false,
        x: event.clientX,
        y: event.clientY,
        rect: node,
        corner,
      }
    },
    { signal }
  )

  viewport.addEventListener(
    "pointermove",
    (event) => {
      if (!drag || drag.pointer !== event.pointerId || drag.model !== canvas)
        return
      updateNodeDrag(drag, event)
    },
    { signal }
  )

  function updateNodeDrag(
    active: NonNullable<typeof drag>,
    event: PointerEvent
  ) {
    const screenX = event.clientX - active.x
    const screenY = event.clientY - active.y
    if (!active.started) {
      if (Math.hypot(screenX, screenY) < 5) return
      active.started = true
      window.getSelection()?.removeAllRanges()
      view.keepPosition()
      if (active.corner) {
        viewport.style.setProperty(
          "--node-drag-cursor",
          active.corner === "nw" || active.corner === "se"
            ? "nwse-resize"
            : "nesw-resize"
        )
      }
      viewport.classList.add("moving-node")
    }
    const { card, node, corner } = active
    const dx = Math.round(screenX / view.scale())
    const dy = Math.round(screenY / view.scale())
    const rect = corner
      ? resizeNode(node, corner, dx, dy)
      : {
          x: node.x + dx,
          y: node.y + dy,
          width: node.width,
          height: node.height,
        }
    active.rect = rect
    if (corner) placeBox(card, rect)
    else card.style.translate = `${dx}px ${dy}px`
    placeBox(resizeFrame, rect)
    operations.previewNode(node.id, rect)
  }

  function clearNodeDrag() {
    const active = drag
    drag = undefined
    viewport.classList.remove("moving-node")
    viewport.style.removeProperty("--node-drag-cursor")
    if (saveAfterDrag) {
      saveAfterDrag = false
      // The pointer handler enqueues the final rectangle before this runs.
      queueMicrotask(() => {
        if (!signal.aborted) void saveDocument()
      })
    }
    if (!active?.started) return
    suppressClick = true
    window.setTimeout(() => {
      suppressClick = false
    }, 0)
  }

  function restoreNodeDrag(active: NonNullable<typeof drag>) {
    const { card, node, model, corner } = active
    if (!card.isConnected || model !== canvas || active.rect === node) return
    if (corner) placeBox(card, node)
    else card.style.translate = ""
    if (selection?.id === node.id && !resizeFrame.hidden)
      placeBox(resizeFrame, node)
    operations.previewNode(node.id, node)
  }

  function finishMove(event: PointerEvent) {
    const active = drag
    if (
      !active ||
      active.pointer !== event.pointerId ||
      (event.type === "lostpointercapture" && event.target !== active.capture)
    )
      return
    if (event.type === "pointerup" && active.model === canvas)
      updateNodeDrag(active, event)
    clearNodeDrag()
    const { card, node, model, rect, corner } = active
    const changed =
      rect.x !== node.x ||
      rect.y !== node.y ||
      rect.width !== node.width ||
      rect.height !== node.height
    if (!changed) {
      restoreNodeDrag(active)
      return
    }
    if (model !== canvas) {
      operations.status("stale")
      return
    }
    if (operations.commitGeometry(node.id, rect)) {
      if (!corner) placeBox(card, rect)
      card.style.translate = ""
    } else restoreNodeDrag(active)
  }
  for (const type of [
    "pointerup",
    "pointercancel",
    "lostpointercapture",
  ] as const)
    window.addEventListener(type, finishMove, { signal })

  scene.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Enter" || !(event.target instanceof Element)) return
      const target = selectionAt(event.target)
      if (target?.element === event.target) {
        event.preventDefault()
        if (select(target.selection)) editSelection()
      }
    },
    { signal }
  )

  window.addEventListener(
    "keydown",
    (event) => {
      if (event.isComposing || !canvas) return
      if (event.key === "Escape" && drag) {
        event.preventDefault()
        const active = drag
        clearNodeDrag()
        restoreNodeDrag(active)
        if (active.capture.hasPointerCapture(active.pointer))
          active.capture.releasePointerCapture(active.pointer)
        return
      }
      if (event.key === "Escape" && !colorMenu.hidden) {
        event.preventDefault()
        closeColors(true)
        return
      }
      if (event.key === "Escape" && (!menu.hidden || inline || form || tool)) {
        event.preventDefault()
        if (!menu.hidden) closeMenu(true)
        else if (inline) inline.close()
        else if (form) closeForm()
        else setTool()
        return
      }
      if (event.altKey) return
      const key = event.key.toLowerCase()
      const target = event.target instanceof Element ? event.target : undefined
      const textEntry = target?.closest(
        "input, textarea, select, [contenteditable]"
      )
      if (event.metaKey || event.ctrlKey) {
        if (key === "s" && !event.shiftKey) {
          event.preventDefault()
          closeMenu(true)
          void saveDocument()
        } else if (!textEntry && (key === "z" || key === "y")) {
          event.preventDefault()
          closeMenu(true)
          changeHistory(key === "y" || event.shiftKey ? "redo" : "undo")
        }
        return
      }
      if (textEntry || inline || form || event.repeat) return
      if (key === "contextmenu" || (key === "f10" && event.shiftKey)) {
        event.preventDefault()
        const item = target ? selectionAt(target) : undefined
        const anchor = (item?.element ?? viewport).getBoundingClientRect()
        showMenu(
          {
            x: anchor.left + anchor.width / 2,
            y: anchor.top + anchor.height / 2,
          },
          item
        )
        return
      }
      if (event.shiftKey) return
      const kind = kinds.find((kind) => insertKeys[kind] === key)
      if (kind) {
        event.preventDefault()
        addNode(kind)
      } else if (key === "i") {
        event.preventDefault()
        const frame = viewport.getBoundingClientRect()
        showMenu({
          x: frame.left + frame.width / 2 - 80,
          y: frame.top + frame.height / 2 - 64,
        })
      } else if (key === "c" && selection?.collection === "nodes") {
        event.preventDefault()
        connectSelection()
      } else if (key === "enter" && target === viewport && selection) {
        event.preventDefault()
        editSelection()
      } else if (
        (key === "delete" || key === "backspace") &&
        (menu.hidden || menuAnchor !== viewport)
      ) {
        event.preventDefault()
        closeMenu(true)
        deleteSelection()
      }
    },
    { signal, capture: true }
  )

  updateLabels()
  return {
    history,
    tools,
    menu,
    inspector,
    toolHint,
    relinkFile,
    updateLabels,
    update(model: Canvas | undefined, busy: boolean, conflicted: boolean) {
      const changed = canvas !== model
      if (changed && drag) clearNodeDrag()
      if (changed && relinkTarget && !relinkTarget.isConnected)
        markFileDrop(false)
      canvas = model
      pending = busy
      saveConflict = conflicted
      if (!canvas || busy) closeMenu()
      if (!canvas) setTool()
      undo.disabled = !canvas || busy
      redo.disabled = !canvas || busy
      if (changed) reflectSelection()
      else updateTools()
    },
  }
}
