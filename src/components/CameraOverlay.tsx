import React, { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, RefreshCw, Hand, Sparkles } from 'lucide-react';
import { GestureState } from '../types';
import { HandTracker } from '../utils/handTracking';

interface CameraOverlayProps {
  onGesture: (state: GestureState) => void;
  gestureState: GestureState;
}

export const CameraOverlay: React.FC<CameraOverlayProps> = ({
  onGesture,
  gestureState,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackerRef = useRef<HandTracker | null>(null);

  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [engineStatus, setEngineStatus] = useState<string>('初始化中...');
  const [isInitializing, setIsInitializing] = useState<boolean>(true);

  // Initialize and start camera
  const startCamera = async () => {
    setIsInitializing(true);
    setCameraError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
          frameRate: { ideal: 60, min: 30 },
        },
        audio: false,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraActive(true);

        // Start hand tracker
        if (!trackerRef.current) {
          trackerRef.current = new HandTracker({
            onGesture: (state) => {
              onGesture(state);
            },
            onError: (err) => {
              console.error('Tracker error:', err);
              setCameraError('手势引擎加载异常，点击重试');
            },
            onStatusChange: (status) => {
              setEngineStatus(status);
            },
          });
        }

        if (canvasRef.current) {
          await trackerRef.current.start(videoRef.current, canvasRef.current);
        }
      }
    } catch (err) {
      console.error('Camera access error:', err);
      setCameraError('请允许摄像头权限以使用手势控制');
      setCameraActive(false);
    } finally {
      setIsInitializing(false);
    }
  };

  const stopCamera = () => {
    if (trackerRef.current) {
      trackerRef.current.stop();
    }
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  }, []);

  // Determine badge color styling based on active gesture
  const getGestureBadgeStyle = () => {
    switch (gestureState.type) {
      case 'yes_reset':
        return 'bg-emerald-500/20 text-emerald-800 border-emerald-400/50 shadow-emerald-500/15';
      case 'fist_rotate':
      case 'swipe_rotate':
        return 'bg-cyan-500/15 text-cyan-700 border-cyan-400/40 shadow-cyan-500/10';
      case 'pinch_zoom':
        return 'bg-rose-500/15 text-rose-700 border-rose-400/40 shadow-rose-500/10';
      case 'spread_zoom':
        return 'bg-emerald-500/15 text-emerald-700 border-emerald-400/40 shadow-emerald-500/10';
      case 'fist_reset':
        return 'bg-amber-500/20 text-amber-800 border-amber-400/50 shadow-amber-500/15';
      case 'hand_detected':
        return 'bg-blue-500/10 text-blue-700 border-blue-300/40 shadow-blue-500/5';
      default:
        return 'bg-neutral-900/5 text-neutral-600 border-neutral-300/50 shadow-black/5';
    }
  };

  return (
    <aside aria-label="摄像头手势捕捉窗口" className="fixed bottom-5 right-5 z-40 flex flex-col items-end pointer-events-auto select-none">
      {/* 窗口上方的动作实时文字描述 (Strictly above the PiP window) */}
      <div
        className={`mb-2.5 px-3.5 py-1.5 rounded-full text-xs font-medium tracking-wide backdrop-blur-md border shadow-sm transition-all duration-200 flex items-center gap-2 ${getGestureBadgeStyle()}`}
      >
        <span
          className={`w-2 h-2 rounded-full ${
            gestureState.type === 'yes_reset'
              ? 'bg-emerald-500'
              : gestureState.type === 'fist_rotate' || gestureState.type === 'swipe_rotate'
              ? 'bg-cyan-500'
              : gestureState.type === 'pinch_zoom'
              ? 'bg-rose-500'
              : gestureState.type === 'spread_zoom'
              ? 'bg-emerald-500'
              : gestureState.type === 'fist_reset'
              ? 'bg-amber-500'
              : gestureState.type === 'hand_detected'
              ? 'bg-blue-500'
              : 'bg-neutral-400'
          }`}
        />
        <span>{gestureState.description || '等待手势捕捉'}</span>
      </div>

      {/* 摄像头及手势捕捉小窗口 */}
      <div className="relative w-56 h-40 sm:w-64 sm:h-44 rounded-2xl overflow-hidden bg-neutral-950 border border-neutral-200/80 shadow-2xl shadow-black/20 group">
        {/* Mirrored Video Feed */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="absolute inset-0 w-full h-full object-cover -scale-x-100 opacity-90"
        />

        {/* Real-time Hand Landmarks Canvas */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        />

        {/* Camera Permission / Error / Loading Screen */}
        {(!cameraActive || cameraError || isInitializing) && (
          <div className="absolute inset-0 bg-neutral-900/95 flex flex-col items-center justify-center p-3 text-center">
            {isInitializing ? (
              <div className="flex flex-col items-center gap-2">
                <RefreshCw className="w-5 h-5 text-cyan-400 animate-spin" />
                <span className="text-[11px] text-neutral-300">{engineStatus}</span>
              </div>
            ) : cameraError ? (
              <div className="flex flex-col items-center gap-2">
                <CameraOff className="w-6 h-6 text-rose-400" />
                <p className="text-[11px] text-neutral-300 leading-tight">{cameraError}</p>
                <button
                  onClick={startCamera}
                  className="mt-1 px-2.5 py-1 text-[11px] bg-white/10 hover:bg-white/20 active:bg-white/30 text-white rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  重试授权
                </button>
              </div>
            ) : (
              <button
                onClick={startCamera}
                className="px-3 py-1.5 bg-neutral-100 hover:bg-white text-neutral-900 font-medium text-xs rounded-xl shadow transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Camera className="w-3.5 h-3.5" />
                启动手势捕捉
              </button>
            )}
          </div>
        )}

        {/* Subtle PiP Controls (Appears on hover) */}
        {cameraActive && (
          <div className="absolute top-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={cameraActive ? stopCamera : startCamera}
              title={cameraActive ? "关闭摄像头" : "打开摄像头"}
              className="p-1 rounded-md bg-black/60 hover:bg-black/80 text-white/80 hover:text-white transition-colors cursor-pointer"
            >
              {cameraActive ? <CameraOff className="w-3.5 h-3.5" /> : <Camera className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}

        {/* Live Tracking Crosshair / Status Corner Marker */}
        {cameraActive && (
          <div className="absolute bottom-2 left-2 flex items-center gap-1.5 pointer-events-none">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                gestureState.handsCount > 0 ? 'bg-cyan-400' : 'bg-white/40'
              }`}
            />
          </div>
        )}
      </div>
    </aside>
  );
};
