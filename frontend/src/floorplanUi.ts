import type { WallSegment } from './floorplanEditor'

export type Bounds = { x1: number; y1: number; x2: number; y2: number }
export type Room = { name: string; type: string; approximate_bounds: Bounds; area_ratio?: number }
export type OpeningKind = 'door' | 'window'
export type ParsedOpening = {
  /** Stable durable identity. */ id?: string
  kind?: OpeningKind
  /** Stable owner, never an array index. */ wallId?: string
  /** Center measured from wall start as a 0..1 local fraction. */ position?: number
  width?: number
  source?: string
  /** false means architectural dimensions are intentionally unknown. */ confirmed?: boolean
  // Legacy parse-only marker fields, converted before persistence.
  type?: string; x?: number; y?: number; from?: string; to?: string
}
export type ParseResult = { rooms: Room[]; walls: WallSegment[]; doors: ParsedOpening[]; windows: ParsedOpening[]; scale: { unit: string; pixel_to_unit?: number }; metadata: { source: string; confidence?: number; image_width?: number; image_height?: number } }
export type ParseResponse = { filename: string; contentType: string; size: number; result: ParseResult }
export type Viewport = { minX: number; minY: number; width: number; height: number }
export type CanvasSize = { width: number; height: number }
export const MIN_OPENING_WIDTH = 8

function record(v: unknown): v is Record<string, unknown> { return typeof v === 'object' && v !== null && !Array.isArray(v) }
function finite(v: unknown): v is number { return typeof v === 'number' && Number.isFinite(v) }
function optional(v: unknown): boolean { return v === undefined || finite(v) }
function id(v: unknown): v is string { return typeof v === 'string' && /^[A-Za-z0-9_-]+$/.test(v) }
function wall(v: unknown): v is WallSegment { return record(v) && finite(v.x1) && finite(v.y1) && finite(v.x2) && finite(v.y2) && (v.id === undefined || id(v.id)) }
function opening(v: unknown): v is ParsedOpening { return record(v) && (v.id === undefined || id(v.id)) && (v.kind === undefined || v.kind === 'door' || v.kind === 'window') && (v.wallId === undefined || id(v.wallId)) && optional(v.position) && optional(v.width) && (v.confirmed === undefined || typeof v.confirmed === 'boolean') && optional(v.x) && optional(v.y) }
function room(v: unknown): v is Room { return record(v) && typeof v.name === 'string' && typeof v.type === 'string' && record(v.approximate_bounds) && finite(v.approximate_bounds.x1) && finite(v.approximate_bounds.y1) && finite(v.approximate_bounds.x2) && finite(v.approximate_bounds.y2) && optional(v.area_ratio) }

export function isParseResponse(value: unknown): value is ParseResponse {
 if (!record(value) || typeof value.filename !== 'string' || typeof value.contentType !== 'string' || !finite(value.size) || value.size < 0 || !record(value.result)) return false
 const r=value.result
 return Array.isArray(r.rooms) && r.rooms.every(room) && Array.isArray(r.walls) && r.walls.every(wall) && Array.isArray(r.doors) && r.doors.every(opening) && Array.isArray(r.windows) && r.windows.every(opening) && record(r.scale) && typeof r.scale.unit === 'string' && optional(r.scale.pixel_to_unit) && record(r.metadata) && typeof r.metadata.source === 'string' && optional(r.metadata.confidence) && optional(r.metadata.image_width) && optional(r.metadata.image_height)
}
export function canvasScale(size: CanvasSize, viewport: Viewport): number | null { if (![size.width,size.height,viewport.width,viewport.height].every(finite) || size.width<=0 || size.height<=0 || viewport.width<=0 || viewport.height<=0) return null; const scale=Math.min(size.width/viewport.width,size.height/viewport.height); return finite(scale)&&scale>0?scale:null }
export function canvasUnitsForCssPixels(cssPixels:number, scale:number|null):number { return !finite(cssPixels)||cssPixels<=0||!scale||!finite(scale)||scale<=0?cssPixels:cssPixels/scale }
export function openingLabel(opening: ParsedOpening): string | null { const type=(opening.kind ?? opening.type)?.trim(); const from=opening.from?.trim(); const to=opening.to?.trim(); const connection=from&&to?`${from} → ${to}`:from||to; return type&&connection?`${type} · ${connection}`:type||connection||null }

export function wallLength(wall: WallSegment): number { return Math.hypot(wall.x2-wall.x1, wall.y2-wall.y1) }
function finiteWallGeometry(wall: WallSegment): boolean { return [wall.x1, wall.y1, wall.x2, wall.y2].every(finite) }
export function openingPoint(wall: WallSegment, item: ParsedOpening): {x:number;y:number}|null { if (!finite(item.position) || !finite(wall.x1) || !finite(wall.y1) || !finite(wall.x2) || !finite(wall.y2)) return null; return {x: wall.x1+(wall.x2-wall.x1)*item.position, y:wall.y1+(wall.y2-wall.y1)*item.position} }
/** Reject invalid state before it enters persistence or geometry. */
export function validateOpenings(walls: readonly WallSegment[], openings: readonly ParsedOpening[]): string | null {
 const explicitWallIDs=new Set<string>()
 for(const wall of walls) {
  if(wall.id !== undefined) {
   if(explicitWallIDs.has(wall.id)) return 'wall id must be unique'
   explicitWallIDs.add(wall.id)
  }
 }
 const byId=new Map(walls.map((w,i)=>[w.id ?? `wall-${i+1}`,w])); const used=new Set<string>(); const perWall=new Map<string,ParsedOpening[]>()
 for(const o of openings){ if(!id(o.id)||used.has(o.id)) return 'opening id must be unique'; used.add(o.id); if((o.kind!=='door'&&o.kind!=='window')||!id(o.wallId)||!finite(o.position)||!finite(o.width)||o.width<MIN_OPENING_WIDTH||o.position<0||o.position>1) return 'opening has invalid local geometry'; const w=byId.get(o.wallId); if(!w || !finiteWallGeometry(w) || !finite(wallLength(w)) || wallLength(w)<=0) return 'opening references a missing or degenerate wall'; if(o.width>=wallLength(w)) return 'opening exceeds wall'; const half=o.width/wallLength(w)/2; if(o.position-half<0||o.position+half>1) return 'opening exceeds wall endpoint'; const list=perWall.get(o.wallId)??[]; list.push(o); perWall.set(o.wallId,list) }
 for(const [wallId,list] of perWall) { const w=byId.get(wallId)!; const sorted=[...list].sort((a,b)=>a.position!-b.position!); for(let i=1;i<sorted.length;i++){ if(sorted[i-1].position!+sorted[i-1].width!/wallLength(w)/2>sorted[i].position!-sorted[i].width!/wallLength(w)/2) return 'openings overlap on wall' } }
 return null
}
