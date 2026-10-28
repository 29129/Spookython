function validateStepInput(input, map) {
  const invalid = (message) => { throw Object.assign(new Error(message), { name: 'InvalidStepRequestError' }) }
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('El cuerpo debe ser un objeto JSON.')
  if (typeof input.sobrevivienteId !== 'string' || !input.sobrevivienteId.trim() || input.sobrevivienteId.length > 128) invalid('sobrevivienteId debe ser un texto de 1 a 128 caracteres.')
  if (!map.nodes.some((node) => node.id === input.nodoActual)) invalid('nodoActual no pertenece al mapa de Manta.')
  if (!Number.isInteger(input.turno) || input.turno < 0) invalid('turno debe ser un entero mayor o igual a cero.')
}
module.exports = { validateStepInput }
