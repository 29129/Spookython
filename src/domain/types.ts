export type StreetType = 'AVENIDA' | 'CALLE' | 'CALLEJON' | 'PUENTE'
export type ZombieType = 'WALKER' | 'RUNNER' | 'HORDE' | 'SLEEPER'
export type SurvivorStatus = 'ACTIVE' | 'BITTEN' | 'RESCUED'

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
}

export interface Zombie {
  id: string
  type: ZombieType
  nodeId: string
  asleep?: boolean
}

export interface Survivor {
  id: string
  nodeId: string
  refugeId: string
  status: SurvivorStatus
  routeNodeIds: string[]
}

export interface GameState {
  worldId: string
  turn: number
  updatedAt: string
  zombies: Zombie[]
  survivors: Survivor[]
  blockedStreetIds: string[]
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
