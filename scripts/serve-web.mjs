import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web')
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
}

const server = createServer(async (request, response) => {
  const requestedPath = new URL(request.url || '/', 'http://localhost').pathname
  const relativePath = requestedPath === '/' ? 'index.html' : decodeURIComponent(requestedPath.slice(1))
  const filePath = path.resolve(root, relativePath)
  if (!filePath.startsWith(`${root}${path.sep}`) && filePath !== path.join(root, 'index.html')) {
    response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Acceso denegado.')
    return
  }

  try {
    const content = await readFile(filePath)
    response.writeHead(200, {
      'content-type': contentTypes[path.extname(filePath)] || 'application/octet-stream',
      'cache-control': 'no-store',
    })
    response.end(content)
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Archivo no encontrado.')
  }
})

server.listen(4173, '127.0.0.1', () => {
  console.log('Spookython Web disponible en http://127.0.0.1:4173')
})
