const paths = {
  select: "M4 2.5 15.5 10l-5 .8-2.7 4.3L4 2.5Z",
  text: "M4 5h12M10 5v11M7 16h6M4 5v2m12-2v2",
  file: "M5 2.5h7l3 3v12H5zM12 2.5v3.8h3M7.5 10h5m-5 3h5",
  link: "m8.2 11.8 3.6-3.6M6.7 9.2 4.3 11.6a3 3 0 0 0 4.2 4.2l2.4-2.4m2.4-2.6 2.4-2.4a3 3 0 0 0-4.2-4.2L9.1 6.6",
  group: "M3 7V3h4m6 0h4v4m0 6v4h-4m-6 0H3v-4M7.5 7.5h5v5h-5z",
  connect: "M3 14.5h3.5c4 0 2-8 6-8H17m-3-3 3 3-3 3",
  color:
    "m5.5 3 7.8 7.8-4.8 4.8a1.4 1.4 0 0 1-2 0l-4-4a1.4 1.4 0 0 1 0-2l6.4-6.4M3 10.5h10m3.3 1.5c1 1.5 1.7 2.4 1.7 3.5a1.7 1.7 0 1 1-3.4 0c0-1.1.7-2 1.7-3.5Z",
  fit: "M3 7V3h4m6 0h4v4m0 6v4h-4m-6 0H3v-4M6 7h8v6H6z",
  undo: "M7.5 4 3 8l4.5 4M3 8h8a4 4 0 0 1 4 4v3",
  redo: "M12.5 4 17 8l-4.5 4M17 8H9a4 4 0 0 0-4 4v3",
}

export function icon(name: keyof typeof paths) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("viewBox", "0 0 20 20")
  svg.setAttribute("aria-hidden", "true")
  const path = document.createElementNS(svg.namespaceURI, "path")
  path.setAttribute("d", paths[name])
  svg.append(path)
  return svg
}
