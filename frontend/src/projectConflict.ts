import type { ParseResponse } from './floorplanUi'

export type ProjectConflictSelection = 'local' | 'remote'

export type ProjectConflictItem = {
  id: string
  collection: 'document' | 'rooms' | 'walls' | 'doors' | 'windows' | 'scale' | 'metadata'
  objectId: string
  field: string
  localValue: unknown
  remoteValue: unknown
  choice: ProjectConflictSelection | null
}

export type ProjectConflict = {
  merged: ParseResponse
  items: ProjectConflictItem[]
}

type RecordValue = Record<string, unknown>
type StableItem = RecordValue & { id?: string }

const equal = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)
const clone = <T>(value: T): T => structuredClone(value)

function mergeValue(
  conflict: ProjectConflict,
  target: RecordValue,
  key: string,
  base: unknown,
  local: unknown,
  remote: unknown,
  identity: Omit<ProjectConflictItem, 'id' | 'field' | 'localValue' | 'remoteValue' | 'choice'>,
) {
  if (equal(local, remote) || equal(remote, base)) {
    if (local === undefined) delete target[key]
    else target[key] = clone(local)
    return
  }
  if (equal(local, base)) {
    if (remote === undefined) delete target[key]
    else target[key] = clone(remote)
    return
  }
  const id = `${identity.collection}:${identity.objectId}:${key}`
  conflict.items.push({ id, ...identity, field: key, localValue: clone(local), remoteValue: clone(remote), choice: null })
  if (remote === undefined) delete target[key]
  else target[key] = clone(remote)
}

function mergeRecord(
  conflict: ProjectConflict,
  target: RecordValue,
  base: RecordValue,
  local: RecordValue,
  remote: RecordValue,
  identity: Omit<ProjectConflictItem, 'id' | 'field' | 'localValue' | 'remoteValue' | 'choice'>,
) {
  const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])
  keys.forEach((key) => mergeValue(conflict, target, key, base[key], local[key], remote[key], identity))
}

function byStableID(items: readonly StableItem[]): Map<string, StableItem> {
  return new Map(items.flatMap((item) => typeof item.id === 'string' ? [[item.id, item] as const] : []))
}

function mergeStableCollection(
  conflict: ProjectConflict,
  collection: 'walls' | 'doors' | 'windows',
  baseItems: readonly StableItem[],
  localItems: readonly StableItem[],
  remoteItems: readonly StableItem[],
): StableItem[] {
  const base = byStableID(baseItems)
  const local = byStableID(localItems)
  const remote = byStableID(remoteItems)
  const ids = [...remote.keys(), ...local.keys()].filter((id, index, all) => all.indexOf(id) === index)
  return ids.flatMap((id) => {
    const baseItem = base.get(id)
    const localItem = local.get(id)
    const remoteItem = remote.get(id)
    if (!baseItem) {
      if (!localItem) return remoteItem ? [clone(remoteItem)] : []
      if (!remoteItem || equal(localItem, remoteItem)) return [clone(localItem)]
    }
    if (!localItem || !remoteItem) {
      if (!baseItem) return [clone((localItem ?? remoteItem)!)]
      const retained = localItem ?? remoteItem
      if (retained && equal(retained, baseItem)) return []
      const target = retained ? clone(retained) : { id }
      conflict.items.push({
        id: `${collection}:${id}:$object`,
        collection,
        objectId: id,
        field: '$object',
        localValue: clone(localItem),
        remoteValue: clone(remoteItem),
        choice: null,
      })
      return remoteItem ? [target] : []
    }
    const target = clone(remoteItem)
    mergeRecord(conflict, target, baseItem ?? {}, localItem, remoteItem, { collection, objectId: id })
    return [target]
  })
}

export function buildProjectConflict(
  confirmed: ParseResponse,
  local: ParseResponse,
  remote: ParseResponse,
  previousChoices: ReadonlyMap<string, ProjectConflictSelection> = new Map(),
): ProjectConflict {
  const merged = clone(remote)
  const conflict: ProjectConflict = { merged, items: [] }
  const mergedDocument = merged as unknown as RecordValue
  const confirmedDocument = confirmed as unknown as RecordValue
  const localDocument = local as unknown as RecordValue
  const remoteDocument = remote as unknown as RecordValue
  new Set([...Object.keys(confirmedDocument), ...Object.keys(localDocument), ...Object.keys(remoteDocument)])
    .forEach((key) => {
      if (key !== 'result') mergeValue(conflict, mergedDocument, key, confirmedDocument[key], localDocument[key], remoteDocument[key], { collection: 'document', objectId: 'document' })
    })

  const result = merged.result as unknown as RecordValue
  mergeValue(conflict, result, 'rooms', confirmed.result.rooms, local.result.rooms, remote.result.rooms, { collection: 'rooms', objectId: 'rooms' })
  mergeRecord(conflict, result.scale as unknown as RecordValue, confirmed.result.scale, local.result.scale, remote.result.scale, { collection: 'scale', objectId: 'scale' })
  mergeRecord(conflict, result.metadata as unknown as RecordValue, confirmed.result.metadata, local.result.metadata, remote.result.metadata, { collection: 'metadata', objectId: 'metadata' })
  merged.result.walls = mergeStableCollection(conflict, 'walls', confirmed.result.walls as unknown as StableItem[], local.result.walls as unknown as StableItem[], remote.result.walls as unknown as StableItem[]) as unknown as ParseResponse['result']['walls']
  merged.result.doors = mergeStableCollection(conflict, 'doors', confirmed.result.doors as unknown as StableItem[], local.result.doors as unknown as StableItem[], remote.result.doors as unknown as StableItem[]) as unknown as ParseResponse['result']['doors']
  merged.result.windows = mergeStableCollection(conflict, 'windows', confirmed.result.windows as unknown as StableItem[], local.result.windows as unknown as StableItem[], remote.result.windows as unknown as StableItem[]) as unknown as ParseResponse['result']['windows']
  conflict.items.forEach((item) => { item.choice = previousChoices.get(item.id) ?? null })
  return conflict
}

export function chooseProjectConflict(conflict: ProjectConflict, id: string, choice: ProjectConflictSelection): ProjectConflict {
  return { ...conflict, items: conflict.items.map((item) => item.id === id ? { ...item, choice } : item) }
}

export function resolveProjectConflictDocument(conflict: ProjectConflict): ParseResponse | null {
  if (conflict.items.some((item) => item.choice === null)) return null
  const resolved = clone(conflict.merged)
  for (const item of conflict.items) {
    const value = item.choice === 'local' ? item.localValue : item.remoteValue
    if (item.collection === 'document') {
      if (value === undefined) delete (resolved as unknown as RecordValue)[item.field]
      else (resolved as unknown as RecordValue)[item.field] = clone(value)
      continue
    }
    if (item.collection === 'rooms') {
      resolved.result.rooms = clone(value) as ParseResponse['result']['rooms']
      continue
    }
    if (item.collection === 'scale' || item.collection === 'metadata') {
      const target = resolved.result[item.collection] as unknown as RecordValue
      if (value === undefined) delete target[item.field]
      else target[item.field] = clone(value)
      continue
    }
    const items = resolved.result[item.collection] as StableItem[]
    const index = items.findIndex((candidate) => candidate.id === item.objectId)
    if (item.field === '$object') {
      if (value === undefined) {
        if (index >= 0) items.splice(index, 1)
      } else if (index >= 0) items[index] = clone(value) as StableItem
      else items.push(clone(value) as StableItem)
    } else if (index >= 0) {
      if (value === undefined) delete items[index][item.field]
      else items[index][item.field] = clone(value)
    }
  }
  return resolved
}
