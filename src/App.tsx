import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { ThreeCanvas } from './components/ThreeCanvas';
import { CameraOverlay } from './components/CameraOverlay';
import { MinimalToolbar } from './components/MinimalToolbar';
import { GestureState } from './types';
import {
  createProceduralDrone,
  createProceduralRoboticArm,
  createProceduralCrystalArtifact,
  loadModelFromFile,
} from './utils/modelLoader';

export default function App() {
  // Preset models
  const presets = useMemo(() => [
    { id: 'drone', factory: createProceduralDrone },
    { id: 'arm', factory: createProceduralRoboticArm },
    { id: 'crystal', factory: createProceduralCrystalArtifact },
  ], []);

  const [presetIndex, setPresetIndex] = useState<number>(0);
  const [currentModel, setCurrentModel] = useState<THREE.Group | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  // Fullscreen toolbar auto-hide state & mouse trigger
  const [isToolbarVisible, setIsToolbarVisible] = useState<boolean>(true);
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Real-time gesture state
  const [gestureState, setGestureState] = useState<GestureState>({
    type: 'none',
    description: '等待手势捕捉',
    isPinching: false,
    pinchCenter: null,
    deltaX: 0,
    deltaY: 0,
    zoomDelta: 0,
    confidence: 0,
    isFistReset: false,
    isYesReset: false,
    handsCount: 0,
  });

  // Load initial preset
  useEffect(() => {
    const model = presets[presetIndex].factory();
    setCurrentModel(model);
  }, [presetIndex, presets]);

  // Cycle preset models
  const handleCyclePreset = useCallback(() => {
    setPresetIndex((prev) => (prev + 1) % presets.length);
  }, [presets.length]);

  // Handle file upload (GLB, GLTF, OBJ, STL, PLY)
  const handleFileUpload = useCallback(async (file: File) => {
    try {
      const { model } = await loadModelFromFile(file);
      setCurrentModel(model);
    } catch (err) {
      console.error('Failed to load 3D model:', err);
    }
  }, []);

  // Reset view triggered manually or by gesture
  const handleResetView = useCallback(() => {
    setGestureState((prev) => ({
      ...prev,
      isYesReset: true,
      description: '比 YES 手势 · 恢复模型默认大小与视角',
    }));

    // Reset flag after brief trigger
    setTimeout(() => {
      setGestureState((prev) => ({
        ...prev,
        isYesReset: false,
      }));
    }, 200);
  }, []);

  // Fullscreen toggle
  const handleToggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
      setIsFullscreen(false);
    }
  }, []);

  // Fullscreen change & mouse interaction handling
  useEffect(() => {
    const handleFsChange = () => {
      const isFs = Boolean(document.fullscreenElement);
      setIsFullscreen(isFs);
      if (isFs) {
        setIsToolbarVisible(false);
      } else {
        setIsToolbarVisible(true);
      }
    };

    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  // Handle mouse movement in fullscreen mode to show hidden buttons
  useEffect(() => {
    if (!isFullscreen) {
      setIsToolbarVisible(true);
      return;
    }

    // In fullscreen: default hidden, mouse triggers appearance
    const handleMouseMove = () => {
      setIsToolbarVisible(true);
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
      hideTimerRef.current = setTimeout(() => {
        setIsToolbarVisible(false);
      }, 2500);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, [isFullscreen]);

  const handleHoverToolbar = useCallback(() => {
    setIsToolbarVisible(true);
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
    }
  }, []);

  // Global Drag & Drop handling for 3D models
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        handleFileUpload(file);
      }
    },
    [handleFileUpload]
  );

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative w-screen h-screen overflow-hidden bg-white select-none"
    >
      {/* 3D WebGL Canvas (Pure White Background) */}
      <ThreeCanvas
        currentModel={currentModel}
        gestureState={gestureState}
      />

      {/* Minimal Icon Toolbar (Hidden in fullscreen, triggered by mouse) */}
      <MinimalToolbar
        onFileUpload={handleFileUpload}
        onResetView={handleResetView}
        onCyclePreset={handleCyclePreset}
        isFullscreen={isFullscreen}
        onToggleFullscreen={handleToggleFullscreen}
        visible={isToolbarVisible}
        onHoverToolbar={handleHoverToolbar}
      />

      {/* Camera & Hand Gesture Capture Window (Bottom Right with real-time text strictly above it) */}
      <CameraOverlay
        onGesture={setGestureState}
        gestureState={gestureState}
      />

      {/* Subtle Drag-and-drop Visual Boundary (Icon-only subtle outline, zero text) */}
      {isDragOver && (
        <div className="pointer-events-none absolute inset-4 border-2 border-dashed border-cyan-400/60 rounded-3xl bg-cyan-500/5 transition-all flex items-center justify-center z-50">
          <div className="w-16 h-16 rounded-2xl bg-white/90 shadow-xl border border-cyan-200/50 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      )}
    </div>
  );
}
