import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useThree, type RootState } from '@react-three/fiber'
import { Grid, Html, OrbitControls } from '@react-three/drei'
import type { BufferGeometry } from 'three'
import { buildWallShellPieces, frameWallShellModel, WINDOW_OPENING_HEIGHT, WINDOW_SILL_HEIGHT, type WallShellModel } from './wallShell'
import { wasmWallMeshPresentation } from './wasmThreeDScene'
import { analyzeCurrentThreeDFrame } from './threeDFrameAnalysis'

export type ThreeDRenderer = { state: RootState; generation: string }

type RendererLifecycleProps = {
  generation: string
  onMount: (renderer: ThreeDRenderer) => void
  onUnmount: (generation: string) => void
}

function RendererLifecycle({ generation, onMount, onUnmount }: RendererLifecycleProps) {
  const state = useThree()
  const stateRef = useRef(state)
  stateRef.current = state
  useEffect(() => {
    // useThree's root state can publish size/frame updates. Renderer admission
    // is a generation lifecycle, not a per-frame lifecycle: remounting the
    // same renderer must never clear an already acknowledged pixel frame.
    onMount({ state: stateRef.current, generation })
    return () => onUnmount(generation)
  }, [generation, onMount, onUnmount])
  return null
}

function RenderedFrameLifecycle({ generation, onFrameRendered }: {
  generation: string
  onFrameRendered: (generation: string) => void
}) {
  const { gl, invalidate } = useThree()
  useEffect(() => {
    let firstFrame = 0
    let secondFrame = 0
    // A keyed Canvas has already mounted the current scene, but its mount is
    // not evidence that a user-visible pixel buffer exists. Ask R3F for a
    // draw, cross two browser frame boundaries, then synchronously read a
    // WebGL pixel. A successful read is an actual completed render pass for
    // this canvas—not a renderer/effect lifecycle proxy or a wall-clock delay.
    invalidate()
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        if (gl.domElement.width < 2 || gl.domElement.height < 2) return
        const width = gl.domElement.width
        const height = gl.domElement.height
        const pixels = new Uint8Array(width * height * 4)
        const context = gl.getContext()
        context.readPixels(
          0,
          0,
          width,
          height,
          context.RGBA,
          context.UNSIGNED_BYTE,
          pixels,
        )
        if (context.getError() !== context.NO_ERROR) return
        // Do not admit a background-only or grid-only canvas. The analyzer
        // requires structurally sized, distributed canonical wall spans (or
        // their selected-violet state), not a small marker or bright grid.
        if (analyzeCurrentThreeDFrame(width, height, pixels).accepted) onFrameRendered(generation)
      })
    })
    return () => {
      cancelAnimationFrame(firstFrame)
      cancelAnimationFrame(secondFrame)
    }
  }, [generation, gl, invalidate, onFrameRendered])
  return null
}

function CameraFramer({ model }: { model: WallShellModel }) {
  const { camera, size, invalidate } = useThree()
  const frame = useMemo(
    () => frameWallShellModel(model, size.width > 0 && size.height > 0 ? size.width / size.height : undefined),
    [model, size.height, size.width],
  )
  useLayoutEffect(() => {
    camera.position.set(...frame.position)
    camera.lookAt(...frame.target)
    camera.updateProjectionMatrix()
    invalidate()
  }, [camera, frame, invalidate])
  return null
}

export type ThreeDPreviewProps = {
  canonicalRevision: string | null
  model: WallShellModel
  wasmGeometry: BufferGeometry | null
  wasmActive: boolean
  webGLAvailable: boolean
  selectedWallID: string | null
  selectedOpeningID: string | null
  onSelectWall: (wallID: string) => void
  onSelectOpening: (openingID: string) => void
  onRendererMount: (renderer: ThreeDRenderer) => void
  onRendererUnmount: (generation: string) => void
  onFrameRendered: (generation: string) => void
}

function CanonicalScene({
  model,
  wasmGeometry,
  wasmActive,
  selectedWallID,
  selectedOpeningID,
  onSelectWall,
  onSelectOpening,
}: Omit<ThreeDPreviewProps, 'canonicalRevision' | 'webGLAvailable' | 'onRendererMount' | 'onRendererUnmount' | 'onFrameRendered'>) {
  const wasmWallMesh = wasmWallMeshPresentation(wasmActive, wasmGeometry, model, onSelectWall)
  const selectedWallPieces = useMemo(
    () => wasmActive && wasmGeometry && selectedWallID ? buildWallShellPieces(model).filter((piece) => piece.wallId === selectedWallID) : [],
    [model, selectedWallID, wasmActive, wasmGeometry],
  )
  return (
    <>
      <ambientLight intensity={0.72} />
      <directionalLight position={[10, 15, 10]} intensity={1.2} castShadow />
      {model.floor && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[model.floor.x, 0, model.floor.z]} receiveShadow data-testid="wall-shell-floor">
          <planeGeometry args={[model.floor.width, model.floor.depth]} />
          <meshStandardMaterial color="#536d9d" roughness={0.82} />
        </mesh>
      )}
      <Grid args={[18, 18]} cellSize={1} cellThickness={0.45} cellColor="#425779" sectionSize={5} sectionThickness={0.8} sectionColor="#90a4c6" fadeDistance={24} infiniteGrid />

      {/* Selection affordance only: success-path walls remain the visible WASM mesh. */}
      {wasmWallMesh && selectedWallPieces.map((piece) => (
        <mesh
          key={`wasm-wall-selection-${piece.id}`}
          position={[piece.x, piece.y, piece.z]}
          rotation={[0, piece.rotationY, 0]}
          data-testid={`three-wall-highlight-${piece.wallId}`}
          renderOrder={1}
        >
          <boxGeometry args={[piece.length, piece.height, piece.thickness + 0.025]} />
          <meshBasicMaterial color="#c4b5fd" toneMapped={false} transparent opacity={0.62} depthWrite={false} />
        </mesh>
      ))}
      {wasmWallMesh && (
        <mesh
          geometry={wasmWallMesh.geometry}
          visible={wasmWallMesh.visible}
          castShadow={wasmWallMesh.castShadow}
          receiveShadow={wasmWallMesh.receiveShadow}
          data-testid="wasm-wall-mesh"
          onPointerDown={(event) => { event.stopPropagation(); wasmWallMesh.onSelectAt(event.point.x, event.point.z) }}
          onClick={(event) => { event.stopPropagation(); wasmWallMesh.onSelectAt(event.point.x, event.point.z) }}
        >
          <meshStandardMaterial
            color="#e8eff9"
            emissive="#0f172a"
            emissiveIntensity={0.04}
            roughness={0.58}
            side={2}
          />
        </mesh>
      )}

      {model.walls.map((wall) => (
        <Html key={`wall-picker-${wall.id}`} position={[wall.x, wall.height + 0.32, wall.z]} center>
          <button
            type="button"
            data-testid={`three-wall-${wall.id}`}
            aria-label="选择墙体"
            aria-pressed={selectedWallID === wall.id}
            data-selected={selectedWallID === wall.id ? 'true' : 'false'}
            className={`h-4 w-4 rounded border border-white p-0 shadow ${selectedWallID === wall.id ? 'bg-violet-500' : 'bg-slate-950/45'}`}
            onClick={() => onSelectWall(wall.id)}
          />
        </Html>
      ))}

      {model.openings.map((opening) => {
        const isDoor = opening.kind === 'door'
        // Put the stable-ID selector at the actual opening center instead of
        // floating it above the wall. It makes the physical cut-out reviewable
        // and keeps 2D/3D selection targets semantically aligned.
        const markerHeight = isDoor ? 1.4 : WINDOW_SILL_HEIGHT + WINDOW_OPENING_HEIGHT / 2
        return (
          <group key={opening.id}>
            <mesh
              data-testid={`three-opening-${opening.id}`}
              position={[opening.x, markerHeight, opening.z]}
              renderOrder={10}
              onPointerDown={(event) => { event.stopPropagation(); onSelectOpening(opening.id) }}
              onClick={(event) => { event.stopPropagation(); onSelectOpening(opening.id) }}
            >
              <sphereGeometry args={[isDoor ? 0.28 : 0.24, 20, 14]} />
              <meshBasicMaterial color={selectedOpeningID === opening.id ? '#7c3aed' : isDoor ? '#f97316' : '#38bdf8'} depthTest={false} toneMapped={false} />
            </mesh>
            <Html position={[opening.x, markerHeight, opening.z]} center>
              <button
                type="button"
                data-testid={`three-opening-button-${opening.id}`}
                aria-label={`选择${isDoor ? '门洞' : '窗洞'}`}
                aria-pressed={selectedOpeningID === opening.id}
                className="h-5 w-5 rounded-full border-2 border-white bg-slate-950/30 p-0 shadow-lg"
                onClick={() => onSelectOpening(opening.id)}
              />
            </Html>
          </group>
        )
      })}
    </>
  )
}

export function ThreeDPreview(props: ThreeDPreviewProps) {
  const frame = frameWallShellModel(props.model)
  if (!props.webGLAvailable) {
    return <div className="flex h-full w-full items-center justify-center px-8 text-center" role="status" aria-label="空间预览不可用"><div className="max-w-sm rounded-2xl border border-amber-400/25 bg-amber-950/30 px-5 py-4 text-sm leading-6 text-amber-100">当前浏览器无法显示空间预览。请换用支持 3D 显示的浏览器；平面图调整仍可继续。</div></div>
  }
  return (
    <Canvas key={props.canonicalRevision ?? 'invalid'} className="absolute inset-0 h-full w-full" camera={{ position: frame.position, fov: 38, near: 0.1, far: 100 }} shadows gl={{ antialias: true, preserveDrawingBuffer: true, alpha: false }} data-testid="three-render-surface">
      <color attach="background" args={['#0c1325']} />
      <RendererLifecycle generation={props.canonicalRevision ?? 'invalid'} onMount={props.onRendererMount} onUnmount={props.onRendererUnmount} />
      <RenderedFrameLifecycle generation={props.canonicalRevision ?? 'invalid'} onFrameRendered={props.onFrameRendered} />
      <Suspense fallback={null}>
        <CameraFramer model={props.model} />
        <CanonicalScene {...props} />
        <OrbitControls makeDefault target={frame.target} minDistance={frame.floorSpan * 0.56} maxDistance={frame.floorSpan * 2.2} />
      </Suspense>
    </Canvas>
  )
}
