const isMac = navigator.platform.startsWith("Mac")

function shortcutLabel(button: HTMLButtonElement) {
  const keys = button.getAttribute("aria-keyshortcuts")?.split(" ") ?? []
  const modifier = isMac ? "Meta+" : "Control+"
  const shortcut = keys.find((key) => key.startsWith(modifier)) ?? keys[0]
  if (!shortcut) return
  return isMac
    ? shortcut
        .replace("Meta+", "⌘")
        .replace("Shift+", "⇧")
        .replace("Escape", "Esc")
    : shortcut.replace("Control+", "Ctrl+").replace("Escape", "Esc")
}

export function labelToolbarButton(
  button: HTMLButtonElement,
  label: string,
  shortcut = shortcutLabel(button)
) {
  let tooltip = button.querySelector<HTMLSpanElement>(".toolbar-tooltip")
  if (tooltip && button.getAttribute("aria-label") === label) return
  button.setAttribute("aria-label", label)
  if (!tooltip) {
    tooltip = document.createElement("span")
    tooltip.className = "toolbar-tooltip"
    tooltip.setAttribute("aria-hidden", "true")
    button.append(tooltip)
  }
  tooltip.textContent = label
  if (shortcut) {
    const key = document.createElement("kbd")
    key.textContent = shortcut
    tooltip.append(key)
  }
}
