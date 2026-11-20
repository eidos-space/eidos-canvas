import MarkdownIt from "markdown-it"
import type { PluginFileSystem, ViewContext } from "@eidos.space/plugin-sdk"
import type { CanvasNode } from "./canvas"
import { fileCardOpenAction, isMarkdownFile } from "./file-card"
import { decodePath, resolveSpacePath, webUrl } from "./paths"

const markdown = new MarkdownIt({ html: false })
const images = /\.(?:png|jpe?g|gif|webp|avif|bmp|ico)$/i
const video = /\.(?:mp4|m4v|mov|webm|mkv)$/i
const audio = /\.(?:mp3|wav|ogg|m4a|flac|opus|weba)$/i

function markdownSection(text: string, subpath?: string): string {
  if (!subpath || subpath === "#") return text
  const fragment = decodePath(subpath.slice(1))
  const lines = text.split(/\r?\n/)
  const tokens = markdown.parse(text, {})
  if (fragment.startsWith("^")) {
    const marker = " " + fragment
    const line = lines.findIndex(
      (line) => line.trim() === fragment || line.trimEnd().endsWith(marker)
    )
    if (line < 0) return text
    const block = tokens.find(
      (token) =>
        token.nesting === 1 &&
        token.map &&
        token.map[0] <= line &&
        token.map[1] > line
    )
    if (!block?.map) return text
    const start = block.map[0]
    const end = block.map[1]
    if (lines[line].trim() === fragment && start === line) {
      const previous = tokens
        .filter(
          (token) =>
            token.nesting === 1 &&
            token.map &&
            token.map[0] < start &&
            token.map[1] <= start
        )
        .at(-1)
      return previous?.map ? lines.slice(...previous.map).join("\n") : text
    }
    lines[line] = lines[line].trimEnd().slice(0, -marker.length)
    return lines.slice(start, end).join("\n")
  }

  const headingKey = (value: string) =>
    value.trim().toLowerCase().replace(/\s+/g, "-")
  const index = tokens.findIndex((token, index) => {
    if (token.type !== "heading_open") return false
    const heading = tokens[index + 1]
    const plain =
      heading?.children?.map((child) => child.content).join("") ?? ""
    return (
      headingKey(heading?.content ?? "") === headingKey(fragment) ||
      headingKey(plain) === headingKey(fragment)
    )
  })
  const heading = tokens[index]
  if (!heading?.map) return text
  const next = tokens
    .slice(index + 1)
    .find((token) => token.type === "heading_open" && token.tag <= heading.tag)
  return lines.slice(heading.map[0], next?.map?.[0]).join("\n")
}

export function createContent(
  ctx: ViewContext,
  fs: PluginFileSystem,
  canvasPath: string,
  signal: AbortSignal,
  feedback: (message: string, anchor: HTMLElement, duration?: number) => void,
  relinkFile: (id: string) => void
) {
  const { ui } = ctx.capabilities
  const t = (key: string) => ctx.i18n.t(key)
  const fileChecks = new Map<string, Promise<boolean>>()
  const markdownSources = new Map<string, Promise<string | undefined>>()
  const mediaUrls = new Map<string, Promise<string | undefined>>()
  const references = new Set<() => Promise<void>>()
  const queuedReferences = new Set<() => Promise<void>>()
  let sourceVersion = 0
  let refreshTimer: number | undefined
  let refreshing = false

  function fileExists(path: string) {
    let result = fileChecks.get(path)
    if (!result) {
      result = fs.stat(path).then((file) => file?.isDirectory === false)
      fileChecks.set(path, result)
    }
    return result
  }

  async function resolve(
    raw: string,
    fromFile = canvasPath,
    relativeFirst = false
  ) {
    const rootPath = resolveSpacePath(raw)
    const relative = resolveSpacePath(raw, fromFile)
    for (const path of new Set(
      relativeFirst ? [relative, rootPath] : [rootPath, relative]
    )) {
      if (signal.aborted) return
      if (path && (await fileExists(path))) return path
    }
  }

  function readMarkdown(path: string) {
    let result = markdownSources.get(path)
    if (!result) {
      result = fs.readText(path).catch(() => undefined)
      markdownSources.set(path, result)
    }
    return result
  }

  function scheduleRefresh() {
    if (
      refreshing ||
      refreshTimer !== undefined ||
      !queuedReferences.size ||
      signal.aborted
    )
      return
    refreshTimer = window.setTimeout(() => {
      refreshTimer = undefined
      void drainReferences()
    }, 60)
  }

  async function drainReferences() {
    refreshing = true
    try {
      while (queuedReferences.size && !signal.aborted) {
        const batch = [...queuedReferences].slice(0, 8)
        for (const refresh of batch) queuedReferences.delete(refresh)
        await Promise.allSettled(batch.map((refresh) => refresh()))
      }
    } finally {
      refreshing = false
    }
  }

  function refreshFiles() {
    sourceVersion++
    fileChecks.clear()
    markdownSources.clear()
    mediaUrls.clear()
    for (const refresh of references) queuedReferences.add(refresh)
    scheduleRefresh()
  }

  signal.addEventListener("abort", () => window.clearTimeout(refreshTimer), {
    once: true,
  })

  function mediaUrl(path: string): Promise<string | undefined> {
    let url = mediaUrls.get(path)
    if (!url) {
      url = fs.getUrl(path).catch(() => undefined)
      mediaUrls.set(path, url)
    }
    return url
  }

  async function openFile(path: string, anchor: HTMLElement, open = ui.openFile) {
    try {
      await open?.(path)
    } catch {
      if (!signal.aborted) feedback(t("file.missing"), anchor)
    }
  }

  function renderMarkdown(
    target: HTMLElement,
    text: string,
    fromFile: string,
    lifetime = signal
  ) {
    const template = document.createElement("template")
    template.innerHTML = markdown.render(text)
    for (const element of Array.from(template.content.querySelectorAll("a"))) {
      const href = element.getAttribute("href") ?? ""
      element.removeAttribute("href")
      if (!href) continue
      element.title = href
      const url = webUrl(href)
      if (url) {
        element.replaceWith(
          copyButton(href, element.textContent || href, undefined, lifetime)
        )
        continue
      }
      const path = decodePath(href.split("#", 1)[0])
      if (
        !path ||
        !(resolveSpacePath(path, fromFile) || resolveSpacePath(path))
      )
        continue
      const link = document.createElement("button")
      link.type = "button"
      link.className = "inline-link"
      link.textContent = element.textContent
      link.title = href
      link.addEventListener(
        "click",
        async () => {
          const found = await resolve(path, fromFile, true).catch(
            () => undefined
          )
          if (lifetime.aborted) return
          if (found) await openFile(found, link)
          else feedback(t("file.missing"), link)
        },
        { signal: lifetime }
      )
      element.replaceWith(link)
    }
    for (const image of Array.from(template.content.querySelectorAll("img"))) {
      const src = decodePath(image.getAttribute("src") ?? "")
      image.removeAttribute("src")
      image.draggable = false
      if (!images.test(src)) continue
      void resolve(src, fromFile, true)
        .catch(() => undefined)
        .then(async (path) => {
          const url =
            path && !lifetime.aborted ? await mediaUrl(path) : undefined
          if (url && !lifetime.aborted) image.src = url
        })
    }
    target.replaceChildren(template.content)
  }

  function copyButton(
    value: string,
    label: string,
    destination?: HTMLInputElement,
    lifetime = signal
  ) {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "inline-link"
    button.textContent = label
    button.title = t("link.copy")
    button.addEventListener(
      "click",
      () => {
        const input = destination ?? document.createElement("input")
        if (!destination) {
          input.className = "copy-target"
          input.value = value
          input.readOnly = true
          button.after(input)
        }
        input.focus({ preventScroll: true })
        input.select()
        let copied = false
        try {
          copied = document.execCommand("copy")
        } catch {
          // The selected value is still available for manual copying.
        }
        if (copied) {
          if (!destination) input.remove()
          button.focus({ preventScroll: true })
        } else if (!destination) {
          input.addEventListener("blur", () => input.remove(), { once: true })
        }
        feedback(
          t(copied ? "link.copied" : "link.select"),
          button,
          copied ? 1600 : 4000
        )
      },
      { signal: lifetime }
    )
    return button
  }

  function renderLink(card: HTMLElement, value: string) {
    const host = document.createElement("strong")
    host.className = "link-host"
    host.textContent = webUrl(value)?.hostname || value
    const input = document.createElement("input")
    input.className = "link-url"
    input.value = value
    input.title = value
    input.setAttribute("aria-label", "URL")
    input.readOnly = true
    card.append(host, input, copyButton(value, t("link.copy"), input))
  }

  function renderFile(
    card: HTMLElement,
    node: Extract<CanvasNode, { type: "file" }>
  ) {
    const header = document.createElement("div")
    header.className = "file-header"
    const name = document.createElement("button")
    name.type = "button"
    name.className = "file-name"
    const label =
      (node.file.split(/[\\/]/).at(-1) || node.file) + (node.subpath ?? "")
    name.textContent = label
    name.title = node.file + (node.subpath ?? "")
    name.disabled = true
    header.append(name)
    const preview = document.createElement("div")
    preview.className = "file-preview"
    card.append(header, preview)
    let linkedPath: string | undefined
    let openOriginal: (() => void) | undefined
    let scope: AbortController | undefined
    let kind:
      | "missing"
      | "unavailable"
      | "markdown"
      | "media"
      | "path"
      | undefined
    let displayedMarkdown: string | undefined

    name.setAttribute("aria-label", t("file.open") + " " + label)
    name.addEventListener(
      "click",
      () => openOriginal?.(),
      { signal }
    )

    function resetPreview(next: typeof kind, className: string) {
      scope?.abort()
      scope = new AbortController()
      kind = next
      preview.className = `file-preview ${className}`
      preview.replaceChildren()
      return AbortSignal.any([signal, scope.signal])
    }

    function unavailable(missing = false) {
      const next = missing ? "missing" : "unavailable"
      if (kind === next) return
      const lifetime = resetPreview(next, "file-fallback")
      preview.textContent = t("file.missing")
      if (missing) {
        const action = document.createElement("button")
        action.className = "file-relink"
        action.type = "button"
        action.textContent = t("file.relink")
        action.title = t("file.relink.hint")
        action.addEventListener("click", () => relinkFile(node.id), {
          signal: lifetime,
        })
        preview.append(action)
      }
    }

    async function refresh() {
      const version = sourceVersion
      const current = () => !signal.aborted && version === sourceVersion
      const path = linkedPath
        ? (await fileExists(linkedPath))
          ? linkedPath
          : undefined
        : await resolve(node.file)
      if (!current()) return
      const open = path ? fileCardOpenAction(ui, path) : undefined
      openOriginal = path && open ? () => void openFile(path, name, open) : undefined
      name.disabled = !openOriginal
      card.toggleAttribute("data-file-missing", !path)
      if (!path) {
        unavailable(true)
        return
      }
      linkedPath = path
      if (isMarkdownFile(path)) {
        const text = await readMarkdown(path)
        if (!current()) return
        if (text === undefined) unavailable()
        else if (kind !== "markdown" || displayedMarkdown !== text) {
          const top = preview.scrollTop
          const left = preview.scrollLeft
          const lifetime = resetPreview("markdown", "markdown")
          renderMarkdown(
            preview,
            markdownSection(text, node.subpath),
            path,
            lifetime
          )
          preview.scrollTop = top
          preview.scrollLeft = left
          displayedMarkdown = text
        }
        return
      }
      if (kind === "media" || kind === "path") return
      const mediaTag = images.test(path)
        ? "img"
        : video.test(path)
          ? "video"
          : audio.test(path)
            ? "audio"
            : undefined
      if (!mediaTag) {
        resetPreview("path", "file-fallback")
        preview.textContent = path
        return
      }
      const url = await mediaUrl(path)
      if (!current()) return
      if (!url) {
        unavailable()
        return
      }
      const lifetime = resetPreview("media", "media-preview")
      const media = document.createElement(mediaTag)
      media.draggable = false
      if (media instanceof HTMLImageElement) {
        media.alt = label
        media.loading = "lazy"
        media.decoding = "async"
      } else {
        media.controls = true
        media.preload = "none"
      }
      media.addEventListener("error", () => unavailable(), {
        once: true,
        signal: lifetime,
      })
      media.src = url
      preview.append(media)
    }

    references.add(refresh)
    queuedReferences.add(refresh)
    scheduleRefresh()
  }

  async function renderGroupBackground(
    card: HTMLElement,
    path: string,
    style?: string
  ) {
    const file = await resolve(path).catch(() => undefined)
    if (!file || !images.test(file) || signal.aborted) return
    const url = await mediaUrl(file)
    if (!url || signal.aborted) return
    const backdrop = document.createElement("div")
    backdrop.className = "group-image"
    backdrop.style.backgroundImage = `url(${JSON.stringify(url)})`
    backdrop.style.backgroundSize =
      style === "ratio" ? "contain" : style === "repeat" ? "auto" : "cover"
    backdrop.style.backgroundRepeat =
      style === "repeat" ? "repeat" : "no-repeat"
    card.prepend(backdrop)
  }

  return {
    renderMarkdown,
    renderLink,
    renderFile,
    renderGroupBackground,
    refreshFiles,
  }
}
