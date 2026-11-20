import type { HostUI } from "@eidos.space/plugin-sdk"

export function isMarkdownFile(path: string): boolean {
  return /\.(?:md|markdown)$/i.test(path)
}

export function fileCardOpenAction(ui: HostUI, path: string) {
  const { openFile } = ui
  if (!openFile) return
  if (isMarkdownFile(path) && ui.openFileTargets?.includes("sidebar"))
    return () => openFile(path, { target: "sidebar" })
  return () => openFile(path)
}
