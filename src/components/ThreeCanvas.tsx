import React, { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GestureState } from '../types';

interface ThreeCanvasProps {
  currentModel: THREE.Group | null;
  gestureState: GestureState;
  onResetComplete?: () => void;
}

export const ThreeCanvas: React.FC<ThreeCanvasProps> = ({
  currentModel,
  gestureState,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelPivotRef = useRef<THREE.Group | null>(null);
  const shadowPlaneRef = useRef<THREE.Mesh | null>(null);

  // Targets for silky smooth exponential damping (60fps lerp)
  const targetRotationY = useRef<number>(0);
  const targetRotationX = useRef<number>(0);
  const targetCameraDistance = useRef<number>(5.5);
  const defaultDistance = 5.5;

  const angularVelocityY = useRef<number>(0);
  const angularVelocityX = useRef<number>(0);
  const isResettingRef = useRef<boolean>(false);
  const resetTimerRef = useRef<NodeJS.Timeout | null>(null);
  const prevGestureRef = useRef<GestureState>(gestureState);

  // Handle gesture commands in real-time
  useEffect(() => {
    const prev = prevGestureRef.current;
    prevGestureRef.current = gestureState;

    // 1. 比 YES 手势恢复模型大小与初始视角 (YES Gesture Reset)
    if (gestureState.isYesReset || gestureState.isFistReset) {
      angularVelocityY.current = 0;
      angularVelocityX.current = 0;
      targetRotationX.current = 0;
      targetRotationY.current = 0;
      targetCameraDistance.current = defaultDistance;
      isResettingRef.current = true;
      if (controlsRef.current) {
        controlsRef.current.target.set(0, 0, 0);
      }
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => {
        isResettingRef.current = false;
      }, 1000);
      return;
    }

    // 2. 握紧拳头移动控制模型多向旋转 (Fist Multi-Directional Rotation)
    if (gestureState.type === 'fist_rotate') {
      if (Math.abs(gestureState.deltaX) > 0.008) {
        angularVelocityY.current += gestureState.deltaX * 0.12;
      }
      if (Math.abs(gestureState.deltaY) > 0.008) {
        angularVelocityX.current += gestureState.deltaY * 0.12;
      }
    } else if (gestureState.type === 'swipe_rotate') {
      if (Math.abs(gestureState.deltaX) > 0.01) {
        angularVelocityY.current += gestureState.deltaX * 0.08;
      }
    }

    // 3. 高灵敏度张开变大 / 捏合变小 (High-Sensitivity Uniform Zoom, NO ROTATION on pinch)
    if (Math.abs(gestureState.zoomDelta) > 0.001) {
      const zoomFactor = gestureState.zoomDelta * 4.6;
      targetCameraDistance.current = Math.max(1.8, Math.min(14.0, targetCameraDistance.current - zoomFactor));
    }
  }, [gestureState]);

  // Set up Three.js scene
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // 1. Scene with Pure White Background
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);
    sceneRef.current = scene;

    // 2. Camera
    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      100
    );
    camera.position.set(0, 1.2, targetCameraDistance.current);
    cameraRef.current = camera;

    // 3. WebGL Renderer configured for high fidelity
    const isHeadless =
      typeof navigator !== 'undefined' &&
      (navigator.webdriver || /HeadlessChrome/i.test(navigator.userAgent));

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    renderer.setPixelRatio(isHeadless ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = !isHeadless;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 4. OrbitControls (fallback mouse/touch control)
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 2.0;
    controls.maxDistance = 14.0;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    // Update target distance when user uses wheel
    controls.addEventListener('change', () => {
      if (!gestureState.isPinching) {
        targetCameraDistance.current = camera.position.length();
      }
    });

    // 5. Studio Environment Reflection (RoomEnvironment)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    const envTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTexture;
    pmremGenerator.dispose();

    // 6. Lighting Rig: 3-point Studio Lighting
    // Warm Key Light
    const keyLight = new THREE.DirectionalLight(0xfff7ea, 2.2);
    keyLight.position.set(4, 7, 5);
    keyLight.castShadow = !isHeadless;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 25;
    keyLight.shadow.camera.left = -4;
    keyLight.shadow.camera.right = 4;
    keyLight.shadow.camera.top = 4;
    keyLight.shadow.camera.bottom = -4;
    keyLight.shadow.bias = -0.0004;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    // Cool Rim Light
    const rimLight = new THREE.DirectionalLight(0xe0f0ff, 1.4);
    rimLight.position.set(-5, 4, -4);
    scene.add(rimLight);

    // Soft Hemisphere Fill
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xf0f0f5, 1.2);
    scene.add(hemiLight);

    // 7. Contact Shadow Floor Grounding (Procedural soft radial shadow)
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 512;
    shadowCanvas.height = 512;
    const sCtx = shadowCanvas.getContext('2d');
    if (sCtx) {
      const gradient = sCtx.createRadialGradient(256, 256, 0, 256, 256, 256);
      gradient.addColorStop(0, 'rgba(0, 0, 0, 0.42)');
      gradient.addColorStop(0.3, 'rgba(0, 0, 0, 0.22)');
      gradient.addColorStop(0.65, 'rgba(0, 0, 0, 0.06)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      sCtx.fillStyle = gradient;
      sCtx.fillRect(0, 0, 512, 512);
    }
    const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
    const shadowGeo = new THREE.PlaneGeometry(7.5, 7.5);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -1.82;
    shadowPlane.receiveShadow = true;
    scene.add(shadowPlane);
    shadowPlaneRef.current = shadowPlane;

    // 8. Model Pivot Group
    const modelPivot = new THREE.Group();
    scene.add(modelPivot);
    modelPivotRef.current = modelPivot;

    // 9. Resize Handler
    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener('resize', handleResize);

    // 10. Animation Loop with Silky Exponential Damping
    let animId: number;
    let clock = new THREE.Clock();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), 0.1);

      // Silky inertia rotation physics
      targetRotationY.current += angularVelocityY.current;
      targetRotationX.current += angularVelocityX.current;
      angularVelocityY.current *= 0.90; // Smooth friction glide
      angularVelocityX.current *= 0.90;

      // Clamp vertical pitch so model does not flip upside down disorientingly
      targetRotationX.current = Math.max(-Math.PI * 0.48, Math.min(Math.PI * 0.48, targetRotationX.current));

      // Smooth model rotation damping (lerp towards targetRotation)
      if (modelPivotRef.current) {
        const dampFactor = 1 - Math.exp(-14 * delta);
        modelPivotRef.current.rotation.y += (targetRotationY.current - modelPivotRef.current.rotation.y) * dampFactor;
        modelPivotRef.current.rotation.x += (targetRotationX.current - modelPivotRef.current.rotation.x) * dampFactor;
      }

      // Smooth camera position and distance damping
      if (cameraRef.current && controlsRef.current) {
        if (isResettingRef.current) {
          const resetDamp = 1 - Math.exp(-8 * delta);
          camera.position.x += (0 - camera.position.x) * resetDamp;
          camera.position.y += (1.2 - camera.position.y) * resetDamp;
          camera.position.z += (defaultDistance - camera.position.z) * resetDamp;
        } else {
          const currentDist = camera.position.length();
          const distDamp = 1 - Math.exp(-12 * delta);
          const newDist = currentDist + (targetCameraDistance.current - currentDist) * distDamp;
          
          if (Math.abs(newDist - currentDist) > 0.001) {
            const dir = camera.position.clone().normalize();
            camera.position.copy(dir.multiplyScalar(newDist));
          }
        }

        controls.update();
      }

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animId);
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Update model in scene when currentModel changes
  useEffect(() => {
    const pivot = modelPivotRef.current;
    if (!pivot) return;

    // Remove existing children
    while (pivot.children.length > 0) {
      pivot.remove(pivot.children[0]);
    }

    if (currentModel) {
      pivot.add(currentModel);

      // Compute bounding box to position shadow plane flush beneath model
      const box = new THREE.Box3().setFromObject(currentModel);
      if (shadowPlaneRef.current && isFinite(box.min.y)) {
        shadowPlaneRef.current.position.y = box.min.y - 0.02;
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxHoriz = Math.max(size.x, size.z);
        shadowPlaneRef.current.scale.setScalar(Math.max(1, maxHoriz / 2.5));
      }
    }
  }, [currentModel]);

  return (
    <div
      ref={mountRef}
      className="absolute inset-0 w-full h-full bg-white select-none overflow-hidden cursor-grab active:cursor-grabbing"
      style={{ touchAction: 'none' }}
    />
  );
};
