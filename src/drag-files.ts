import { resolveSpacePath } from "./paths"

const singlePath = "application/x-eidos-lite-space-path"
const multiplePaths = "application/x-eidos-lite-space-paths"

export function isSpaceFileDrag(
  transfer: Pick<DataTransfer, "types">
): boolean {
  return (
    transfer.types.includes(singlePath) ||
    transfer.types.includes(multiplePaths)
  )
}

export function draggedMarkdownPaths(
  transfer: Pick<DataTransfer, "types" | "getData">
): string[] {
  if (!isSpaceFileDrag(transfer)) return []
  const grouped = transfer.getData(multiplePaths)
  let paths: unknown[] = [transfer.getData(singlePath)]
  if (grouped) {
    try {
      const parsed: unknown = JSON.parse(grouped)
      if (Array.isArray(parsed)) paths = parsed
    } catch {
      // Single-selection payloads still carry the primary path.
    }
  }
  const accepted = new Set<string>()
  for (const path of paths) {
    if (typeof path !== "string" || path.length > 1024) continue
    if (resolveSpacePath(path) === path && /\.(?:md|markdown)$/i.test(path))
      accepted.add(path)
    if (accepted.size === 128) break
  }
  return [...accepted]
}
