export type GestureType =
  | 'none'
  | 'yes_reset'
  | 'fist_rotate'
  | 'fist_reset'
  | 'pinch_zoom'
  | 'spread_zoom'
  | 'swipe_rotate'
  | 'hand_detected';

export interface GestureState {
  type: GestureType;
  description: string;
  isPinching: boolean;
  pinchCenter: { x: number; y: number } | null;
  deltaX: number;
  deltaY: number;
  zoomDelta: number;
  confidence: number;
  isFistReset: boolean;
  isYesReset: boolean;
  handsCount: number;
}

export interface ModelMetadata {
  name: string;
  format: 'glb' | 'gltf' | 'obj' | 'stl' | 'ply' | 'procedural';
  fileSize?: string;
  vertexCount?: number;
}
