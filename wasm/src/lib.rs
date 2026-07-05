use wasm_bindgen::prelude::*;

/// 体素引擎初始化
#[wasm_bindgen]
pub fn init() {
    // 初始化 panic hook
    console_error_panic_hook::set_once();
}

/// Marching Cubes 表面提取（占位）
#[wasm_bindgen]
pub fn marching_cubes(data: &[u8], threshold: f32) -> Vec<f32> {
    // Phase 0: 返回空，待实现
    let _ = (data, threshold);
    vec![]
}

#[wasm_bindgen]
pub fn greet(name: &str) -> String {
    format!("HomeVox WASM engine ready, {}!", name)
}
