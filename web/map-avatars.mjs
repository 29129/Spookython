const namespace = 'http://www.w3.org/2000/svg'
const atlasUrl = new URL('./assets/avatars/spookython-pixel-atlas.png', import.meta.url).href
// Viewports crop the transparent atlas at render time, without stretching sprites.
export const avatarRegions = {
  survivor: [55, 162, 261, 350], walker: [416, 161, 316, 350],
  runner: [775, 152, 331, 373], horde: [1125, 162, 402, 360],
  sleeper: [33, 617, 346, 285], refuge: [401, 584, 334, 343],
  truck: [756, 589, 397, 338], blocked: [1155, 589, 351, 328],
}

export function avatarSprite(type, size = 30, { centered = false } = {}) {
  const region = avatarRegions[type]
  if (!region) throw new Error(`Avatar desconocido: ${type}`)
  const sprite = document.createElementNS(namespace, 'svg')
  const attributes = { x: -size / 2, y: centered ? -size / 2 : 5 - size,
    width: size, height: size, viewBox: region.join(' '),
    preserveAspectRatio: 'xMidYMid meet', class: `avatar-sprite avatar-${type}`, 'aria-hidden': 'true' }
  for (const [key, value] of Object.entries(attributes)) sprite.setAttribute(key, value)
  const image = document.createElementNS(namespace, 'image')
  image.setAttribute('href', atlasUrl)
  image.setAttribute('width', '1536')
  image.setAttribute('height', '1024')
  sprite.append(image)
  return sprite
}

export function hydrateAvatarLegends() {
  for (const icon of document.querySelectorAll('[data-avatar]')) {
    const svg = document.createElementNS(namespace, 'svg')
    svg.setAttribute('viewBox', '-16 -16 32 32')
    svg.setAttribute('aria-hidden', 'true')
    svg.append(avatarSprite(icon.dataset.avatar, 30, { centered: true }))
    icon.replaceChildren(svg)
  }
}
