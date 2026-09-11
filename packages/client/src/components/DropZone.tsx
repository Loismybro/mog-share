import React, { useRef, useState } from 'react';
import { 
  UploadCloud, 
  File, 
  FileText, 
  Image as ImageIcon, 
  Film, 
  Archive, 
  X, 
  Send,
  AlertCircle
} from 'lucide-react';
import { formatBytes } from '../utils/formatters';
import { sound } from '../utils/audio';
import { Device } from '../types';

interface DropZoneProps {
  files: File[];
  onFilesChange: (files: File[]) => void;
  targetDevice: Device | null;
  onSend: () => void;
  isTransferring: boolean;
}

export const DropZone: React.FC<DropZoneProps> = ({
  files,
  onFilesChange,
  targetDevice,
  onSend,
  isTransferring,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      sound.playPop();
      const droppedFiles = Array.from(e.dataTransfer.files);
      onFilesChange([...files, ...droppedFiles]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      sound.playPop();
      const selected = Array.from(e.target.files);
      onFilesChange([...files, ...selected]);
      // Reset input value so re-selecting the same file works seamlessly
      e.target.value = '';
    }
  };

  const removeFile = (index: number) => {
    sound.playPop();
    onFilesChange(files.filter((_, i) => i !== index));
  };

  const getFileIcon = (file: File) => {
    if (file.type.startsWith('image/')) return <ImageIcon className="w-4 h-4 text-[#00F59B]" />;
    if (file.type.startsWith('video/')) return <Film className="w-4 h-4 text-[#FF90E8]" />;
    if (file.type.includes('pdf') || file.type.includes('text')) return <FileText className="w-4 h-4 text-[#60A5FA]" />;
    if (file.name.endsWith('.zip') || file.name.endsWith('.tar') || file.name.endsWith('.gz')) {
      return <Archive className="w-4 h-4 text-[#FFC900]" />;
    }
    return <File className="w-4 h-4 text-slate-400" />;
  };

  const totalBytes = files.reduce((acc, f) => acc + f.size, 0);

  return (
    <div className="w-full max-w-xl mx-auto px-4 mb-8 relative z-10 animate-pop">
      {/* Accessible off-screen native file input with explicit ID to prevent Android Activity detachment */}
      <input
        type="file"
        id="mog-native-file-input"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        multiple
        className="sr-only"
        tabIndex={-1}
      />

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`neo-box p-6 border-dashed border-3 transition-all duration-200 bg-[#131722] ${
          isDragOver
            ? 'border-[#00F59B] bg-[#1a2335] shadow-[8px_8px_0px_#000] scale-[1.01]'
            : 'border-[#2a324b] hover:border-[#3e4868] shadow-[6px_6px_0px_#000]'
        }`}
      >
        {files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <label
              htmlFor="mog-native-file-input"
              className="cursor-pointer group flex flex-col items-center justify-center w-full"
            >
              <div className="w-14 h-14 rounded-2xl bg-[#1e2436] border-2 border-[#2a324b] shadow-[3px_3px_0px_#000] flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                <UploadCloud className="w-8 h-8 text-[#FFC900] stroke-[2.5]" />
              </div>
              <h3 className="text-base font-black uppercase text-white m-0 font-mono">
                Drag & Drop or Tap To Choose Files
              </h3>
              <p className="text-xs font-bold text-slate-400 mt-1 mb-4">
                Direct P2P Chunk Streaming • No Cloud Size Limits
              </p>
              <span className="neo-btn neo-btn-yellow px-5 py-2.5 text-xs font-black uppercase text-black select-none pointer-events-none">
                Browse Files (Photos, Videos, Any)
              </span>
            </label>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between pb-3 border-b-2 border-[#2a324b] mb-3">
              <span className="neo-badge bg-[#FFC900] text-black">
                QUEUED ({files.length} • {formatBytes(totalBytes)})
              </span>
              <div className="flex gap-2 text-xs font-bold font-mono">
                <label
                  htmlFor="mog-native-file-input"
                  className="text-[#60A5FA] hover:underline cursor-pointer select-none"
                >
                  + ADD MORE
                </label>
                <span className="text-slate-600">•</span>
                <button
                  type="button"
                  onClick={() => onFilesChange([])}
                  className="text-rose-400 hover:underline cursor-pointer"
                >
                  CLEAR ALL
                </button>
              </div>
            </div>

            {/* File List */}
            <div className="max-h-40 overflow-y-auto space-y-2 pr-1">
              {files.map((file, idx) => (
                <div
                  key={`${file.name}-${idx}`}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-[#1a1f2e] border-2 border-[#2a324b] text-xs shadow-[2px_2px_0px_#000]"
                >
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    {getFileIcon(file)}
                    <span className="truncate max-w-[240px] font-bold text-slate-200">{file.name}</span>
                    <span className="text-[11px] text-slate-400 font-mono font-bold">
                      {formatBytes(file.size)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(idx)}
                    className="p-1 rounded-md hover:bg-[#283048] text-slate-400 hover:text-rose-400 cursor-pointer"
                  >
                    <X className="w-4 h-4 stroke-[3]" />
                  </button>
                </div>
              ))}
            </div>

            {/* Guidance banner when files are queued without a target */}
            {!targetDevice && files.length > 0 && (
              <div className="mt-3 p-3 rounded-xl bg-amber-950/70 border-2 border-amber-500/70 text-amber-200 text-xs flex items-start sm:items-center gap-2.5 shadow-[2px_2px_0px_#000]">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
                <span className="font-mono text-[11px] leading-relaxed">
                  <strong className="text-white">Waiting for recipient:</strong> Open MOG-SHARE on another device (or in another browser tab) and click its card above to send.
                </span>
              </div>
            )}

            {/* Send CTA */}
            <div className="mt-4 pt-3 border-t-2 border-[#2a324b] flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="text-xs font-bold text-slate-300">
                Target:{' '}
                {targetDevice ? (
                  <span className="neo-badge bg-[#00F59B] text-black ml-1 inline-block">
                    {targetDevice.name}
                  </span>
                ) : (
                  <span className="neo-badge bg-[#1e2436] border-[#2a324b] text-amber-400 ml-1 inline-block">
                    Select A Target Above
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={onSend}
                disabled={!targetDevice || isTransferring}
                className={`neo-btn w-full sm:w-auto px-6 py-3 text-xs font-black uppercase text-black ${
                  targetDevice && !isTransferring
                    ? 'neo-btn-mint cursor-pointer shadow-[3px_3px_0px_#000]'
                    : 'bg-zinc-700 text-zinc-400 opacity-60 cursor-not-allowed'
                }`}
              >
                <Send className="w-4 h-4 stroke-[3]" />
                <span>
                  {!targetDevice
                    ? 'Select Target Above To Send'
                    : isTransferring
                    ? 'Transferring...'
                    : 'Send Files Now'}
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
