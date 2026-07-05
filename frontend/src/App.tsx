import { Canvas } from '@react-three/fiber'
import { OrbitControls, Grid } from '@react-three/drei'
import { Suspense } from 'react'

function Scene() {
  return (
    <>
      {/* 方向光 */}
      <ambientLight intensity={0.4} />
      <directionalLight position={[10, 15, 10]} intensity={0.8} castShadow />
      
      {/* 地面 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial color="#2a2a3e" />
      </mesh>
      
      {/* 参考网格 */}
      <Grid
        args={[20, 20]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#444466"
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#6666aa"
        fadeDistance={30}
        infiniteGrid
      />
      
      {/* 测试立方体 */}
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#4a90d9" />
      </mesh>
    </>
  )
}

export default function App() {
  return (
    <div className="w-full h-full relative">
      {/* 顶部状态栏 */}
      <div className="absolute top-0 left-0 right-0 z-10 bg-black/40 backdrop-blur-sm px-4 py-2 flex items-center justify-between">
        <span className="text-sm font-medium text-white/80">筑居 HomeVox — Phase 0</span>
        <span className="text-xs text-white/50">3D Viewport</span>
      </div>
      
      {/* 3D 画布 */}
      <Canvas
        camera={{ position: [8, 6, 8], fov: 50 }}
        shadows
        gl={{ antialias: true }}
      >
        <Suspense fallback={null}>
          <Scene />
          <OrbitControls makeDefault />
        </Suspense>
      </Canvas>
      
      {/* 底部提示 */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-white/30">
        拖拽旋转 · 滚轮缩放 · 右键平移
      </div>
    </div>
  )
}
