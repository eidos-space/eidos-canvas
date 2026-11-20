import type { HostUI } from "@eidos.space/plugin-sdk"

export function isMarkdownFile(path: string): boolean {
  return /\.(?:md|markdown)$/i.test(path)
}

export function fileCardOpenAction(ui: HostUI, path: string) {
  return isMarkdownFile(path)
    ? (ui.openFileInSidebar ?? ui.openFile)
    : ui.openFile
}
