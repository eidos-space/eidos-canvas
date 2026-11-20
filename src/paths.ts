export function resolveSpacePath(
  path: string,
  fromFile = ""
): string | undefined {
  if (!path || /^[\\/]|:|[\u0000-\u001f\u007f]/.test(path)) return
  const parts = fromFile ? fromFile.split("/").slice(0, -1) : []
  for (const segment of path.replaceAll("\\", "/").split("/")) {
    if (!segment || segment === ".") continue
    if (segment === "..") {
      if (!parts.length) return
      parts.pop()
    } else {
      parts.push(segment)
    }
  }
  return parts.length ? parts.join("/") : undefined
}

export function decodePath(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

export function webUrl(url: string): URL | undefined {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === "https:" || parsed.protocol === "http:")
      return parsed
  } catch {
    // The file may contain a plain label or an unsupported URL.
  }
}
