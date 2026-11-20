import type { Point, Rect } from "./canvas"

export function createViewport(
  viewport: HTMLElement,
  scene: HTMLElement,
  setZoomLabel: (percent: number) => void,
  signal: AbortSignal
) {
  let bounds: Rect | undefined
  let x = 0
  let y = 0
  let zoom = 1
  let minimumZoom = 0.04
  let fitted = true
  let spaceHeld = false
  let drag:
    | {
        pointer: number
        clientX: number
        clientY: number
        x: number
        y: number
      }
    | undefined

  function render() {
    scene.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`
    scene.style.setProperty("--canvas-scale", String(zoom))
    const spacing = Math.max(14, Math.min(32, 24 * zoom))
    viewport.style.backgroundSize = `${spacing}px ${spacing}px`
    viewport.style.backgroundPosition = `${x % spacing}px ${y % spacing}px`
    setZoomLabel(Math.max(1, Math.round(zoom * 100)))
  }

  function fit() {
    fitted = true
    if (!bounds || !viewport.clientWidth || !viewport.clientHeight) return
    const width = viewport.clientWidth
    const height = viewport.clientHeight
    const paddingX = Math.min(44, width / 6)
    const paddingY = Math.min(52, height / 6)
    zoom = Math.min(
      1,
      (width - paddingX * 2) / bounds.width,
      (height - paddingY * 2) / bounds.height
    )
    minimumZoom = Math.min(0.04, zoom / 2)
    x = width / 2 - (bounds.x + bounds.width / 2) * zoom
    y = height / 2 - (bounds.y + bounds.height / 2) * zoom
    render()
  }

  function scaleTo(
    value: number,
    point: Point = { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 }
  ) {
    if (!bounds) return
    const next = Math.max(minimumZoom, Math.min(4, value))
    const ratio = next / zoom
    x = point.x - (point.x - x) * ratio
    y = point.y - (point.y - y) * ratio
    zoom = next
    fitted = false
    render()
  }

  function move(dx: number, dy: number) {
    if (!bounds) return
    fitted = false
    x += dx
    y += dy
    render()
  }

  viewport.addEventListener(
    "wheel",
    (event) => {
      if (viewport.classList.contains("moving-node")) {
        event.preventDefault()
        return
      }
      const target = event.target instanceof Element ? event.target : null
      const scroller = target?.closest(".markdown")
      if (
        scroller &&
        !event.ctrlKey &&
        !event.metaKey &&
        (scroller.scrollHeight > scroller.clientHeight ||
          scroller.scrollWidth > scroller.clientWidth)
      )
        return
      if (!bounds) return
      event.preventDefault()
      const { left, top } = viewport.getBoundingClientRect()
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? viewport.clientHeight
            : 1
      if (event.deltaX && !event.deltaY && !event.ctrlKey && !event.metaKey) {
        move(-event.deltaX * unit, 0)
      } else {
        scaleTo(
          zoom *
            Math.exp(
              Math.max(-200, Math.min(200, -event.deltaY * unit)) * 0.0025
            ),
          {
            x: event.clientX - left,
            y: event.clientY - top,
          }
        )
      }
    },
    { passive: false, signal }
  )

  viewport.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target instanceof Element ? event.target : null
      if (
        !bounds ||
        drag ||
        !event.isPrimary ||
        (event.button !== 0 && event.button !== 1)
      )
        return
      if (target?.closest("button, input, audio, video")) return
      if (
        event.pointerType === "mouse" &&
        !spaceHeld &&
        event.button === 0 &&
        target?.closest(".node.card")
      )
        return
      event.preventDefault()
      viewport.focus({ preventScroll: true })
      viewport.setPointerCapture(event.pointerId)
      drag = {
        pointer: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        x,
        y,
      }
      viewport.classList.add("dragging")
    },
    { signal }
  )

  viewport.addEventListener(
    "pointermove",
    (event) => {
      if (drag?.pointer !== event.pointerId) return
      fitted = false
      x = drag.x + event.clientX - drag.clientX
      y = drag.y + event.clientY - drag.clientY
      render()
    },
    { signal }
  )

  function finishDrag(event: PointerEvent) {
    if (drag?.pointer !== event.pointerId) return
    drag = undefined
    viewport.classList.remove("dragging")
  }
  for (const event of [
    "pointerup",
    "pointercancel",
    "lostpointercapture",
  ] as const)
    viewport.addEventListener(event, finishDrag, { signal })

  viewport.addEventListener(
    "keydown",
    (event) => {
      if (
        !bounds ||
        event.isComposing ||
        event.defaultPrevented ||
        viewport.classList.contains("moving-node") ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return
      if (event.target !== viewport) {
        const target = event.target instanceof Element ? event.target : null
        if (
          !["+", "=", "-", "0"].includes(event.key) ||
          !target?.closest("[data-node-id]") ||
          target.closest(
            "input, textarea, select, button, audio, video, [contenteditable]"
          )
        )
          return
      }
      switch (event.key) {
        case " ":
          spaceHeld = true
          viewport.classList.add("space-held")
          break
        case "+":
        case "=":
          scaleTo(zoom * 1.25)
          break
        case "-":
          scaleTo(zoom / 1.25)
          break
        case "0":
          fit()
          break
        case "ArrowLeft":
          move(55, 0)
          break
        case "ArrowRight":
          move(-55, 0)
          break
        case "ArrowUp":
          move(0, 55)
          break
        case "ArrowDown":
          move(0, -55)
          break
        default:
          return
      }
      event.preventDefault()
    },
    { signal }
  )

  const releaseSpace = () => {
    spaceHeld = false
    viewport.classList.remove("space-held")
  }
  viewport.addEventListener(
    "keyup",
    (event) => {
      if (event.key === " ") releaseSpace()
    },
    { signal }
  )
  viewport.addEventListener("blur", releaseSpace, { signal })

  const resize = new ResizeObserver(() => {
    if (fitted) fit()
  })
  resize.observe(viewport)
  signal.addEventListener("abort", () => resize.disconnect(), { once: true })
  return {
    fit,
    toCanvas(point: Point): Point {
      const frame = viewport.getBoundingClientRect()
      return {
        x: Math.round((point.x - frame.left - x) / zoom),
        y: Math.round((point.y - frame.top - y) / zoom),
      }
    },
    keepPosition() {
      fitted = false
    },
    scale: () => zoom,
    zoomIn: () => scaleTo(zoom * 1.25),
    zoomOut: () => scaleTo(zoom / 1.25),
    resetZoom: () => scaleTo(1),
    setBounds(next: Rect | undefined) {
      bounds = next
      if (!next) {
        fitted = true
        x = 0
        y = 0
        zoom = 1
        render()
      } else if (fitted) fit()
    },
  }
}
