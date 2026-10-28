const NS = 'http://www.w3.org/2000/svg'
export const avatarRegions = Object.fromEntries(['survivor', 'walker', 'runner', 'horde', 'sleeper', 'refuge', 'truck', 'blocked'].map(type => [type, true]))
const colors = { survivor: '#61e3eb', walker: '#ff6679', runner: '#ffb15d', horde: '#ad76ff', sleeper: '#ad76ff', refuge: '#63e6a3', truck: '#f4bd62', blocked: '#ff6679' }
function el(name, attributes = {}) {
  const node = document.createElementNS(NS, name)
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value)
  return node
}
function person(group, x = 0, y = 0, scale = 1, runner = false, zombie = false) {
  const figure = el('g', { transform: `translate(${x} ${y}) scale(${scale})`, fill: 'none', stroke: 'currentColor', 'stroke-width': 2.3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
  figure.append(el('circle', { cx: runner ? 14 : 12, cy: 4.5, r: 2.4, fill: 'currentColor', stroke: 'none' }))
  figure.append(el('path', { d: runner ? 'M12 9l-3 5 5 2 3 6M10 13l-5 7-4 1M12 9l5 3 4-3M12 9l-4-1-4 4' : zombie ? 'M12 9l-1 6M11 10l-5 2-3-2M12 10l5 3 4-1M11 15l-3 7M11 15l5 6' : 'M12 9v6M12 10l-5 4-3-1M12 10l5 4 3-1M12 15l-4 7M12 15l4 7' }))
  group.append(figure)
}
export function avatarSprite(type, size = 30, { centered = false } = {}) {
  if (!avatarRegions[type]) throw new Error(`Avatar desconocido: ${type}`)
  const svg = el('svg', { x: -size / 2, y: centered ? -size / 2 : 5 - size, width: size, height: size, viewBox: '0 0 24 24', class: `avatar-sprite avatar-${type}`, 'aria-hidden': 'true', color: colors[type] })
  if (type === 'survivor' || type === 'walker' || type === 'sleeper' || type === 'runner') person(svg, 0, 0, 1, type === 'runner', type !== 'survivor')
  if (type === 'horde') { person(svg, -1, 6, .65, false, true); person(svg, 9, 6, .65, false, true); person(svg, 4, -1, .7, false, true) }
  if (type === 'refuge') {
    svg.append(el('path', { d: 'M2 11L12 2l10 9-2 2-2-2v11h-5v-7h-3v7H5V11l-2 2Z', fill: 'currentColor' }))
  }
  if (type === 'truck') {
    svg.append(el('path', { d: 'M2 7h12v4h5l3 4v5H2Z', fill: 'currentColor' }), el('path', { d: 'M15 12h3l2 3h-5Z', fill: '#0b141b' }))
    for (const cx of [6, 18]) svg.append(el('circle', { cx, cy: 20, r: 3, fill: '#0b141b', stroke: 'currentColor', 'stroke-width': 1.5 }))
  }
  if (type === 'blocked') {
    svg.append(el('path', { d: 'M3 4v18M21 4v18M3 7h18v9H3Z', fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }), el('path', { d: 'M5 15l5-7M12 15l5-7', stroke: 'currentColor', 'stroke-width': 3 }))
  }
  return svg
}
export function hydrateAvatarLegends() {
  for (const icon of document.querySelectorAll('[data-avatar]')) {
    const svg = el('svg', { viewBox: '-16 -16 32 32', 'aria-hidden': 'true' })
    svg.append(avatarSprite(icon.dataset.avatar, 28, { centered: true }))
    icon.replaceChildren(svg)
  }
}
