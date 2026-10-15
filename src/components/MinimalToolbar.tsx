import React, { useRef } from 'react';
import { Upload, RotateCcw, Box, Maximize2, Minimize2 } from 'lucide-react';

interface MinimalToolbarProps {
  onFileUpload: (file: File) => void;
  onResetView: () => void;
  onCyclePreset: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  visible: boolean;
  onHoverToolbar?: () => void;
}

export const MinimalToolbar: React.FC<MinimalToolbarProps> = ({
  onFileUpload,
  onResetView,
  onCyclePreset,
  isFullscreen,
  onToggleFullscreen,
  visible,
  onHoverToolbar,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFileUpload(e.target.files[0]);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <>
      {/* Invisible hover trigger area in top-left to reveal toolbar with mouse */}
      <div
        onMouseEnter={onHoverToolbar}
        className="fixed top-0 left-0 w-48 h-20 z-20 pointer-events-auto"
      />

      <nav
        aria-label="快捷工具栏"
        onMouseEnter={onHoverToolbar}
        className={`fixed top-5 left-5 z-30 flex items-center gap-2 select-none transition-all duration-300 ease-out ${
          visible
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 -translate-y-3 pointer-events-none'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".glb,.gltf,.obj,.stl,.ply"
          onChange={handleFileChange}
          className="hidden"
        />

        {/* Upload Model (Icon only) */}
        <button
          onClick={() => fileInputRef.current?.click()}
          aria-label="导入 3D 模型"
          className="w-10 h-10 rounded-xl bg-white/80 hover:bg-white active:bg-neutral-100 text-neutral-700 hover:text-neutral-900 border border-neutral-200/80 shadow-md shadow-black/5 backdrop-blur-md flex items-center justify-center transition-all cursor-pointer hover:scale-105 active:scale-95"
        >
          <Upload className="w-4 h-4" />
        </button>

        {/* Cycle Built-in 3D Models (Icon only) */}
        <button
          onClick={onCyclePreset}
          aria-label="切换内置 3D 模型"
          className="w-10 h-10 rounded-xl bg-white/80 hover:bg-white active:bg-neutral-100 text-neutral-700 hover:text-neutral-900 border border-neutral-200/80 shadow-md shadow-black/5 backdrop-blur-md flex items-center justify-center transition-all cursor-pointer hover:scale-105 active:scale-95"
        >
          <Box className="w-4 h-4" />
        </button>

        {/* Reset Camera View (Icon only) */}
        <button
          onClick={onResetView}
          aria-label="重置视角"
          className="w-10 h-10 rounded-xl bg-white/80 hover:bg-white active:bg-neutral-100 text-neutral-700 hover:text-neutral-900 border border-neutral-200/80 shadow-md shadow-black/5 backdrop-blur-md flex items-center justify-center transition-all cursor-pointer hover:scale-105 active:scale-95"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        {/* Fullscreen Toggle (Icon only) */}
        <button
          onClick={onToggleFullscreen}
          aria-label="全屏切换"
          className="w-10 h-10 rounded-xl bg-white/80 hover:bg-white active:bg-neutral-100 text-neutral-700 hover:text-neutral-900 border border-neutral-200/80 shadow-md shadow-black/5 backdrop-blur-md flex items-center justify-center transition-all cursor-pointer hover:scale-105 active:scale-95"
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </nav>
    </>
  );
};
