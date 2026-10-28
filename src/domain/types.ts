export type StreetType = 'AVENIDA' | 'CALLE' | 'CALLEJON' | 'PUENTE'
export type ZombieType = 'WALKER' | 'RUNNER' | 'HORDE' | 'SLEEPER'
export type SurvivorStatus = 'ACTIVE' | 'ONBOARD' | 'BITTEN' | 'RESCUED'

export interface MapNode {
  id: string
  lat: number
  lng: number
  refugeId?: string
}

export interface Street {
  id: string
  fromNode: string
  toNode: string
  distanceM: number
  type: StreetType
  speedMps: number
  osmHighway: string
  osmWayId: number
  name?: string
  oneWay: boolean
  geometry: Array<[lng: number, lat: number]>
}

export interface Refuge {
  id: string
  name: string
  nodeId: string
  lat: number
  lng: number
  capacity?: number | null
  occupied?: number
  reserved?: number
}

export interface Zombie {
  id: string
  type: ZombieType
  nodeId: string
  asleep?: boolean
}

export type CityEventType = 'BRIDGE_COLLAPSE' | 'AVENUE_BLOCK'

export interface CityEvent {
  type: CityEventType
  streetId: string
  turn: number
}

export interface Survivor {
  id: string
  nodeId: string
  refugeId: string | null
  status: SurvivorStatus
  routeNodeIds: string[]
  vehicleId?: string | null
  rescuedTurn?: number
}

export interface RescueVehicle {
  id: string
  nodeId: string
  capacity: 4
  passengerIds: string[]
  totalPickedUp: number
  routeNodeIds: string[]
  targetSurvivorId: string | null
}

export interface GameState {
  schemaVersion: 2
  worldId: string
  sessionId: string
  revision: number
  round: 1 | 2 | 3
  pro: boolean
  runnerContactBites?: boolean
  phase: 'READY' | 'DECIDING'
  turnToken?: string
  roundFinished: boolean
  turn: number
  updatedAt: string
  zombies: Zombie[]
  survivors: Survivor[]
  blockedStreetIds: string[]
  lastEvent?: CityEvent | null
  refuges: Refuge[]
  vehicles: RescueVehicle[]
  reservations: Record<string, string>
  metrics: { requests: number; errors: number; timeouts: number; invalidMoves: number; slowTurns: number }
}

export interface MantaMap {
  schemaVersion: 1
  metadata: {
    name: string
    source: 'OpenStreetMap'
    sourceTimestamp: string
    attribution: string
    license: 'ODbL-1.0'
    boundingBox: { south: number; west: number; north: number; east: number }
    nodeCount: number
    streetCount: number
  }
  nodes: MapNode[]
  streets: Street[]
  refuges: Refuge[]
}
