import { FilesetResolver, HandLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision';
import { GestureState, GestureType } from '../types';

export interface HandTrackerCallbacks {
  onGesture: (state: GestureState) => void;
  onError?: (err: Error) => void;
  onStatusChange?: (status: string) => void;
}

export class HandTracker {
  private handLandmarker: HandLandmarker | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private canvasElement: HTMLCanvasElement | null = null;
  private canvasCtx: CanvasRenderingContext2D | null = null;
  private animationFrameId: number | null = null;
  private isRunning: boolean = false;
  private lastVideoTime: number = -1;

  // Smoothing states & gesture tracking
  private prevFistCenter: { x: number; y: number } | null = null;
  private prevTwoHandsDist: number | null = null;
  private prevHandX: number | null = null;
  private prevHandY: number | null = null;
  private yesHoldCount: number = 0;
  private lastResetTriggerTime: number = 0;
  private wasPinching: boolean = false;
  private wasFist: boolean = false;

  // Filtered deltas for silky-smooth 60fps motion
  private smoothDeltaX: number = 0;
  private smoothDeltaY: number = 0;
  private smoothZoomDelta: number = 0;

  private callbacks: HandTrackerCallbacks;

  constructor(callbacks: HandTrackerCallbacks) {
    this.callbacks = callbacks;
  }

  public async initialize(): Promise<void> {
    try {
      this.callbacks.onStatusChange?.('加载高精度手势引擎...');
      
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
      );

      // Try GPU delegate first, fallback to CPU if GPU fails
      try {
        this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      } catch (gpuErr) {
        console.warn('Falling back to CPU delegate for HandLandmarker:', gpuErr);
        this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      }

      this.callbacks.onStatusChange?.('手势引擎准备就绪');
    } catch (error) {
      console.error('Failed to initialize HandLandmarker:', error);
      this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  public async start(video: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<void> {
    this.videoElement = video;
    this.canvasElement = canvas;
    this.canvasCtx = canvas.getContext('2d');

    if (!this.handLandmarker) {
      await this.initialize();
    }

    this.isRunning = true;
    this.processLoop();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.prevFistCenter = null;
    this.prevTwoHandsDist = null;
    this.prevHandX = null;
    this.prevHandY = null;
    this.yesHoldCount = 0;
    this.wasPinching = false;
    this.wasFist = false;
  }

  private processLoop = (): void => {
    if (!this.isRunning || !this.videoElement || !this.handLandmarker) {
      return;
    }

    if (this.videoElement.readyState >= 2) {
      const currentTime = this.videoElement.currentTime;
      if (currentTime !== this.lastVideoTime) {
        this.lastVideoTime = currentTime;
        const nowMs = performance.now();
        const results = this.handLandmarker.detectForVideo(this.videoElement, nowMs);

        this.handleDetectionResults(results);
      }
    }

    this.animationFrameId = requestAnimationFrame(this.processLoop);
  };

  private handleDetectionResults(results: {
    landmarks: NormalizedLandmark[][];
    handedness?: unknown[];
  }): void {
    const canvas = this.canvasElement;
    const ctx = this.canvasCtx;

    if (canvas && ctx && this.videoElement) {
      if (canvas.width !== this.videoElement.videoWidth || canvas.height !== this.videoElement.videoHeight) {
        canvas.width = this.videoElement.videoWidth || 320;
        canvas.height = this.videoElement.videoHeight || 240;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    const landmarksList = results.landmarks;
    if (!landmarksList || landmarksList.length === 0) {
      this.prevFistCenter = null;
      this.prevTwoHandsDist = null;
      this.prevHandX = null;
      this.prevHandY = null;
      this.yesHoldCount = 0;
      this.wasPinching = false;

      // Smooth decay of velocities
      this.smoothDeltaX *= 0.8;
      this.smoothDeltaY *= 0.8;
      this.smoothZoomDelta *= 0.8;

      this.callbacks.onGesture({
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
      return;
    }

    const primaryHand = landmarksList[0];
    const handsCount = landmarksList.length;

    // Palm scale normalization for distance invariance
    const palmLength = Math.hypot(
      primaryHand[9].x - primaryHand[0].x,
      primaryHand[9].y - primaryHand[0].y
    );
    const handScale = Math.max(palmLength, 0.05);

    // =========================================================================
    // 优先级 1: 比 YES 手势 (V / 剪刀手 / Peace sign) -> 恢复模型大小与初始视角
    // =========================================================================
    const isYes = this.detectYesGesture(primaryHand, handScale);
    const now = performance.now();

    if (isYes) {
      this.yesHoldCount++;
      const shouldTrigger = this.yesHoldCount >= 2 && now - this.lastResetTriggerTime > 1000;
      if (shouldTrigger) {
        this.lastResetTriggerTime = now;
      }

      this.prevFistCenter = null;
      this.prevTwoHandsDist = null;
      this.prevHandX = null;
      this.prevHandY = null;
      this.wasPinching = false;

      this.callbacks.onGesture({
        type: 'yes_reset',
        description: '比 YES 手势 · 恢复模型默认大小与视角',
        isPinching: false,
        pinchCenter: null,
        deltaX: 0,
        deltaY: 0,
        zoomDelta: 0,
        confidence: 0.99,
        isFistReset: false,
        isYesReset: shouldTrigger,
        handsCount,
      });

      this.drawHandLandmarks(landmarksList, 'yes_reset');
      return;
    } else {
      this.yesHoldCount = 0;
    }

    // Key fingertips & joints
    const thumbTip = primaryHand[4];
    const thumbMcp = primaryHand[2];
    const indexTip = primaryHand[8];
    const indexMcp = primaryHand[5];

    // Extension lengths
    const indexExt = Math.hypot(indexTip.x - indexMcp.x, indexTip.y - indexMcp.y) / handScale;
    const thumbExt = Math.hypot(thumbTip.x - thumbMcp.x, thumbTip.y - thumbMcp.y) / handScale;
    const tiDist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y) / handScale;

    // =========================================================================
    // 双手模式检测 (若视野中有双手)
    // =========================================================================
    if (handsCount >= 2) {
      const hand1 = landmarksList[0];
      const hand2 = landmarksList[1];
      const h1Center = hand1[9]; // Middle MCP
      const h2Center = hand2[9];
      const twoHandsDist = Math.hypot(h1Center.x - h2Center.x, h1Center.y - h2Center.y);

      const h1Pinch = Math.hypot(hand1[4].x - hand1[8].x, hand1[4].y - hand1[8].y) / handScale < 0.50;
      const h2Pinch = Math.hypot(hand2[4].x - hand2[8].x, hand2[4].y - hand2[8].y) / handScale < 0.50;

      let zoomDelta = 0;
      let desc = '双手捕捉中';
      let gType: GestureType = 'hand_detected';

      if (this.prevTwoHandsDist !== null) {
        const rawDiff = twoHandsDist - this.prevTwoHandsDist;
        if (h1Pinch || h2Pinch || rawDiff < -0.004) {
          zoomDelta = -0.07;
          gType = 'pinch_zoom';
          desc = '双手捏合靠近 · 灵敏缩小模型';
        } else if (rawDiff > 0.004) {
          zoomDelta = 0.07;
          gType = 'spread_zoom';
          desc = '双手张开远离 · 灵敏放大模型';
        }
      } else if (h1Pinch || h2Pinch) {
        zoomDelta = -0.07;
        gType = 'pinch_zoom';
        desc = '双手捏合中 · 灵敏缩小模型';
      }

      this.prevTwoHandsDist = twoHandsDist;
      this.smoothZoomDelta = this.smoothZoomDelta * 0.2 + zoomDelta * 0.8;

      if (gType !== 'hand_detected') {
        this.callbacks.onGesture({
          type: gType,
          description: desc,
          isPinching: gType === 'pinch_zoom',
          pinchCenter: null,
          deltaX: 0,
          deltaY: 0,
          zoomDelta: this.smoothZoomDelta,
          confidence: 0.95,
          isFistReset: false,
          isYesReset: false,
          handsCount,
        });
        this.drawHandLandmarks(landmarksList, gType, undefined, gType === 'pinch_zoom', gType === 'spread_zoom');
        return;
      }
    } else {
      this.prevTwoHandsDist = null;
    }

    // =========================================================================
    // 优先级 2: 握紧拳头 (四指蜷缩入掌，手掌成拳，严格锁定大小，全向控制旋转)
    // 握拳时绝不误判为双指捏合或缩小，锁定当前模型大小，并跟随拳头移动方向进行 360° 全向旋转
    // =========================================================================
    const isFist = this.detectFist(primaryHand, handScale);

    if (isFist) {
      this.wasFist = true;
      this.wasPinching = false;

      const fistCenter = {
        x: (primaryHand[0].x + primaryHand[9].x) / 2,
        y: (primaryHand[0].y + primaryHand[9].y) / 2,
      };

      let deltaX = 0;
      let deltaY = 0;

      if (this.prevFistCenter) {
        const rawDx = -(fistCenter.x - this.prevFistCenter.x);
        const rawDy = fistCenter.y - this.prevFistCenter.y;
        const moveDist = Math.hypot(rawDx, rawDy);

        if (moveDist > 0.001) {
          this.smoothDeltaX = this.smoothDeltaX * 0.25 + rawDx * 0.75;
          this.smoothDeltaY = this.smoothDeltaY * 0.25 + rawDy * 0.75;
          deltaX = this.smoothDeltaX * 15.0;
          deltaY = this.smoothDeltaY * 15.0;
        } else {
          this.smoothDeltaX *= 0.5;
          this.smoothDeltaY *= 0.5;
        }
      }

      this.prevFistCenter = fistCenter;
      this.prevHandX = null;
      this.prevHandY = null;

      const isMoving = Math.hypot(deltaX, deltaY) > 0.015;
      let desc = '握拳中 · 已锁定大小，移动控制旋转';

      if (isMoving) {
        if (Math.abs(deltaX) > Math.abs(deltaY) * 1.15) {
          desc = deltaX < 0 ? '握拳向左 · 模型向左旋转' : '握拳向右 · 模型向右旋转';
        } else if (Math.abs(deltaY) > Math.abs(deltaX) * 1.15) {
          desc = deltaY < 0 ? '握拳向上 · 模型向上俯仰' : '握拳向下 · 模型向下俯仰';
        } else {
          desc = '握拳移动中 · 360° 控制模型旋转';
        }
      }

      this.callbacks.onGesture({
        type: 'fist_rotate',
        description: desc,
        isPinching: false,
        pinchCenter: null,
        deltaX,
        deltaY,
        zoomDelta: 0,
        confidence: 0.99,
        isFistReset: false,
        isYesReset: false,
        handsCount,
      });

      this.drawHandLandmarks(landmarksList, 'fist_rotate', fistCenter);
      return;
    } else {
      this.wasFist = false;
      this.prevFistCenter = null;
    }

    // =========================================================================
    // 优先级 3: 双指打开进行放大 (拇指与食指伸开，指间距加大)
    // =========================================================================
    const isSpread = indexExt > 0.58 && thumbExt > 0.48 && tiDist > 0.46;

    if (isSpread) {
      this.prevFistCenter = null;
      this.prevHandX = null;
      this.prevHandY = null;
      this.wasPinching = false;
      this.wasFist = false;

      const intensity = Math.min(2.2, (tiDist - 0.46) * 3.0 + 1.0);
      const zoomDelta = 0.075 * intensity;
      this.smoothZoomDelta = this.smoothZoomDelta * 0.2 + zoomDelta * 0.8;

      const pinchCenter = {
        x: (thumbTip.x + indexTip.x) / 2,
        y: (thumbTip.y + indexTip.y) / 2,
      };

      this.callbacks.onGesture({
        type: 'spread_zoom',
        description: '双指打开中 · 灵敏放大模型',
        isPinching: false,
        pinchCenter,
        deltaX: 0,
        deltaY: 0,
        zoomDelta: this.smoothZoomDelta,
        confidence: 0.98,
        isFistReset: false,
        isYesReset: false,
        handsCount,
      });

      this.drawHandLandmarks(landmarksList, 'spread_zoom', pinchCenter, false, true);
      return;
    }

    // =========================================================================
    // 优先级 4: 双指捏合进行缩小 (食指尖与拇指尖贴近碰触，且排除握拳)
    // =========================================================================
    const pinchThreshold = this.wasPinching ? 0.48 : 0.42;
    const isPinching = tiDist < pinchThreshold;
    this.wasPinching = isPinching;

    if (isPinching) {
      this.prevFistCenter = null;
      this.prevHandX = null;
      this.prevHandY = null;
      this.wasFist = false;

      const intensity = Math.min(2.2, (0.48 - tiDist) * 3.5 + 1.0);
      const zoomDelta = -0.075 * intensity;
      this.smoothZoomDelta = this.smoothZoomDelta * 0.2 + zoomDelta * 0.8;

      const pinchCenter = {
        x: (thumbTip.x + indexTip.x) / 2,
        y: (thumbTip.y + indexTip.y) / 2,
      };

      this.callbacks.onGesture({
        type: 'pinch_zoom',
        description: '双指捏合中 · 灵敏缩小模型',
        isPinching: true,
        pinchCenter,
        deltaX: 0,
        deltaY: 0,
        zoomDelta: this.smoothZoomDelta,
        confidence: 0.98,
        isFistReset: false,
        isYesReset: false,
        handsCount,
      });

      this.drawHandLandmarks(landmarksList, 'pinch_zoom', pinchCenter, true, false);
      return;
    }

    // =========================================================================
    // 优先级 5: 单手自然滑动旋转 (手指左右滑)
    // =========================================================================
    let deltaX = 0;
    let deltaY = 0;

    const trackingPoint = primaryHand[8];
    const currentX = trackingPoint.x;
    const currentY = trackingPoint.y;

    if (this.prevHandX !== null && this.prevHandY !== null) {
      const rawDx = -(currentX - this.prevHandX);
      const rawDy = currentY - this.prevHandY;

      if (Math.hypot(rawDx, rawDy) > 0.001) {
        this.smoothDeltaX = this.smoothDeltaX * 0.25 + rawDx * 0.75;
        this.smoothDeltaY = this.smoothDeltaY * 0.25 + rawDy * 0.75;
        deltaX = this.smoothDeltaX * 10.0;
        deltaY = this.smoothDeltaY * 10.0;
      } else {
        this.smoothDeltaX *= 0.6;
        this.smoothDeltaY *= 0.6;
      }
    }

    this.prevHandX = currentX;
    this.prevHandY = currentY;

    let gestureType: GestureType = 'hand_detected';
    let desc = '比YES复位 / 握拳锁定旋转 / 双指捏合缩小';

    if (Math.abs(deltaX) > 0.02) {
      gestureType = 'swipe_rotate';
      desc = deltaX < 0 ? '手指向左滑动 · 向左丝滑旋转' : '手指向右滑动 · 向右丝滑旋转';
    }

    this.callbacks.onGesture({
      type: gestureType,
      description: desc,
      isPinching: false,
      pinchCenter: null,
      deltaX,
      deltaY,
      zoomDelta: 0,
      confidence: 0.95,
      isFistReset: false,
      isYesReset: false,
      handsCount,
    });

    this.drawHandLandmarks(landmarksList, gestureType);
  }

  /**
   * Detects YES (Victory / Peace / V sign):
   * 1. Index finger extended.
   * 2. Middle finger extended.
   * 3. Ring finger curled.
   * 4. Pinky finger curled.
   */
  private detectYesGesture(landmarks: NormalizedLandmark[], handScale: number): boolean {
    const wrist = landmarks[0];

    // Index & Middle: must be extended
    const indexTip = landmarks[8];
    const indexPip = landmarks[6];
    const indexMcp = landmarks[5];

    const middleTip = landmarks[12];
    const middlePip = landmarks[10];
    const middleMcp = landmarks[9];

    // In video, smaller Y is higher up
    const isIndexExtended =
      indexTip.y < indexPip.y &&
      Math.hypot(indexTip.x - indexMcp.x, indexTip.y - indexMcp.y) > 0.8 * handScale;

    const isMiddleExtended =
      middleTip.y < middlePip.y &&
      Math.hypot(middleTip.x - middleMcp.x, middleTip.y - middleMcp.y) > 0.8 * handScale;

    // Ring & Pinky: must be curled into palm
    const ringTip = landmarks[16];
    const ringPip = landmarks[14];
    const ringMcp = landmarks[13];

    const pinkyTip = landmarks[20];
    const pinkyPip = landmarks[18];
    const pinkyMcp = landmarks[17];

    const isRingCurled =
      ringTip.y > ringPip.y - 0.05 * handScale ||
      Math.hypot(ringTip.x - ringMcp.x, ringTip.y - ringMcp.y) < 0.65 * handScale;

    const isPinkyCurled =
      pinkyTip.y > pinkyPip.y - 0.05 * handScale ||
      Math.hypot(pinkyTip.x - pinkyMcp.x, pinkyTip.y - pinkyMcp.y) < 0.65 * handScale;

    return isIndexExtended && isMiddleExtended && isRingCurled && isPinkyCurled;
  }

  /**
   * Detects clenched fist from ANY orientation (front, side-profile, tilted):
   * 1. Middle, Ring, Pinky curled into palm.
   * 2. Index curled towards palm.
   * 3. Thumb resting on index or curled against palm (not extended outward).
   */
  private detectFist(landmarks: NormalizedLandmark[], handScale: number): boolean {
    const wrist = landmarks[0];
    const thumbTip = landmarks[4];
    const indexMcp = landmarks[5];
    const indexPip = landmarks[6];
    const indexTip = landmarks[8];
    const middleMcp = landmarks[9];
    const middlePip = landmarks[10];
    const middleTip = landmarks[12];
    const ringMcp = landmarks[13];
    const ringTip = landmarks[16];
    const pinkyMcp = landmarks[17];
    const pinkyTip = landmarks[20];

    const indexExt = Math.hypot(indexTip.x - indexMcp.x, indexTip.y - indexMcp.y) / handScale;

    // 如果食指伸出（如指向、张开或双指放大），绝对不属于握拳！
    if (indexExt > 0.72) {
      return false;
    }

    const palmCenter = {
      x: (wrist.x + middleMcp.x) / 2,
      y: (wrist.y + middleMcp.y) / 2,
    };

    const fingers = [
      { tip: indexTip, pip: indexPip, mcp: indexMcp },
      { tip: middleTip, pip: middlePip, mcp: middleMcp },
      { tip: ringTip, pip: landmarks[14], mcp: ringMcp },
      { tip: pinkyTip, pip: landmarks[18], mcp: pinkyMcp },
    ];

    let curledCount = 0;
    for (const f of fingers) {
      const tipToWrist = Math.hypot(f.tip.x - wrist.x, f.tip.y - wrist.y);
      const pipToWrist = Math.hypot(f.pip.x - wrist.x, f.pip.y - wrist.y);
      const tipToMcp = Math.hypot(f.tip.x - f.mcp.x, f.tip.y - f.mcp.y) / handScale;
      const tipToPalm = Math.hypot(f.tip.x - palmCenter.x, f.tip.y - palmCenter.y) / handScale;

      // 手指蜷缩：指尖靠近指根/掌心，或者指尖朝向手腕
      const isCurled = tipToMcp < 0.88 || tipToPalm < 0.86 || tipToWrist <= pipToWrist * 1.25;
      if (isCurled) {
        curledCount++;
      }
    }

    // 后三指（中指、无名指、小指）卷曲度
    const middleDist = Math.hypot(middleTip.x - middleMcp.x, middleTip.y - middleMcp.y) / handScale;
    const ringDist = Math.hypot(ringTip.x - ringMcp.x, ringTip.y - ringMcp.y) / handScale;
    const pinkyDist = Math.hypot(pinkyTip.x - pinkyMcp.x, pinkyTip.y - pinkyMcp.y) / handScale;
    const backThreeCurled = (middleDist < 0.86 ? 1 : 0) + (ringDist < 0.86 ? 1 : 0) + (pinkyDist < 0.86 ? 1 : 0) >= 2;

    // 握拳时大拇指搭在食指/中指外侧或掌侧，而非翘起或水平向外伸展
    const distThumbToPalm = Math.hypot(thumbTip.x - palmCenter.x, thumbTip.y - palmCenter.y) / handScale;
    const distThumbToIndexPip = Math.hypot(thumbTip.x - indexPip.x, thumbTip.y - indexPip.y) / handScale;
    const distThumbToMiddlePip = Math.hypot(thumbTip.x - middlePip.x, thumbTip.y - middlePip.y) / handScale;
    const thumbExt = Math.hypot(thumbTip.x - landmarks[2].x, thumbTip.y - landmarks[2].y) / handScale;

    const isThumbTucked =
      distThumbToPalm < 1.15 ||
      distThumbToIndexPip < 1.05 ||
      distThumbToMiddlePip < 1.05 ||
      thumbExt < 0.90;

    // 握拳状态维持与判定
    return (curledCount >= 3 || backThreeCurled) && isThumbTucked && indexExt < 0.72;
  }

  /**
   * High performance skeleton & landmark visualizer on the camera overlay.
   */
  private drawHandLandmarks(
    landmarksList: NormalizedLandmark[][],
    gesture: GestureType,
    centerPoint?: { x: number; y: number },
    isPinching: boolean = false,
    isSpreading: boolean = false
  ): void {
    const ctx = this.canvasCtx;
    const canvas = this.canvasElement;
    if (!ctx || !canvas) return;

    const HAND_CONNECTIONS = [
      [0, 1], [1, 2], [2, 3], [3, 4],       // Thumb
      [0, 5], [5, 6], [6, 7], [7, 8],       // Index
      [0, 9], [9, 10], [10, 11], [11, 12],  // Middle
      [0, 13], [13, 14], [14, 15], [15, 16],// Ring
      [0, 17], [17, 18], [18, 19], [19, 20],// Pinky
      [5, 9], [9, 13], [13, 17],            // Palm base
    ];

    ctx.save();
    // Mirror drawing to match CSS mirrored video
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);

    let strokeColor = 'rgba(255, 255, 255, 0.45)';
    let jointColor = 'rgba(255, 255, 255, 0.85)';
    let activeColor = '#00d2ff'; // Cyan default

    if (gesture === 'yes_reset') {
      strokeColor = 'rgba(16, 185, 129, 0.85)'; // Emerald Green for YES reset
      activeColor = '#34d399';
    } else if (gesture === 'fist_rotate') {
      strokeColor = 'rgba(0, 220, 255, 0.85)'; // Cyan for 360 fist rotate
      activeColor = '#00f0ff';
    } else if (gesture === 'swipe_rotate') {
      strokeColor = 'rgba(0, 220, 255, 0.7)';
      activeColor = '#00f0ff';
    } else if (isPinching) {
      strokeColor = 'rgba(244, 63, 94, 0.85)'; // Vivid Rose for pinch shrink
      activeColor = '#fb7185';
    } else if (isSpreading) {
      strokeColor = 'rgba(52, 211, 153, 0.85)'; // Emerald for grow
      activeColor = '#34d399';
    }

    landmarksList.forEach((hand) => {
      // 1. Draw connecting bones
      ctx.beginPath();
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = strokeColor;
      for (const [from, to] of HAND_CONNECTIONS) {
        const p1 = hand[from];
        const p2 = hand[to];
        ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
        ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height);
      }
      ctx.stroke();

      // 2. Draw joints
      hand.forEach((lm, idx) => {
        const x = lm.x * canvas.width;
        const y = lm.y * canvas.height;
        ctx.beginPath();

        const isTip = idx === 4 || idx === 8 || idx === 12 || idx === 16 || idx === 20;
        const radius = isTip ? 4.8 : 2.5;

        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = isTip ? activeColor : jointColor;
        ctx.fill();
      });

      // Special highlight for YES gesture (V tips)
      if (gesture === 'yes_reset') {
        const iX = hand[8].x * canvas.width;
        const iY = hand[8].y * canvas.height;
        const mX = hand[12].x * canvas.width;
        const mY = hand[12].y * canvas.height;

        ctx.beginPath();
        ctx.arc(iX, iY, 9, 0, Math.PI * 2);
        ctx.arc(mX, mY, 9, 0, Math.PI * 2);
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      // Special highlight for fist rotation
      if (gesture === 'fist_rotate' && centerPoint) {
        const cx = centerPoint.x * canvas.width;
        const cy = centerPoint.y * canvas.height;

        ctx.beginPath();
        ctx.arc(cx, cy, 18, 0, Math.PI * 2);
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      }

      // Special highlight for pinch/zoom fingers
      if (isPinching) {
        const pThumb = hand[4];
        const pIndex = hand[8];
        const tX = pThumb.x * canvas.width;
        const tY = pThumb.y * canvas.height;
        const iX = pIndex.x * canvas.width;
        const iY = pIndex.y * canvas.height;

        ctx.beginPath();
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = '#fb7185';
        ctx.moveTo(tX, tY);
        ctx.lineTo(iX, iY);
        ctx.stroke();
      }
    });

    ctx.restore();
  }
}
