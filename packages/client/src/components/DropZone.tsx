import React, { useRef, useState } from 'react';
import { 
  UploadCloud, 
  File, 
  FileText, 
  Image as ImageIcon, 
  Film, 
  Archive, 
  X, 
  Send 
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
    }
  };

  const removeFile = (index: number) => {
    sound.playPop();
    onFilesChange(files.filter((_, i) => i !== index));
  };

  const getFileIcon = (file: File) => {
    if (file.type.startsWith('image/')) return <ImageIcon className="w-4 h-4 text-emerald-600" />;
    if (file.type.startsWith('video/')) return <Film className="w-4 h-4 text-purple-600" />;
    if (file.type.includes('pdf') || file.type.includes('text')) return <FileText className="w-4 h-4 text-blue-600" />;
    if (file.name.endsWith('.zip') || file.name.endsWith('.tar') || file.name.endsWith('.gz')) {
      return <Archive className="w-4 h-4 text-amber-600" />;
    }
    return <File className="w-4 h-4 text-slate-700" />;
  };

  const totalBytes = files.reduce((acc, f) => acc + f.size, 0);

  return (
    <div className="w-full max-w-xl mx-auto px-4 mb-8">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        multiple
        className="hidden"
      />

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`neo-box p-6 border-dashed border-3 transition-all duration-150 ${
          isDragOver
            ? 'bg-amber-100 border-black shadow-[8px_8px_0px_#000] scale-[1.01]'
            : 'bg-white border-black hover:shadow-[7px_7px_0px_#000]'
        }`}
      >
        {files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[#FF90E8] border-3 border-black shadow-[3px_3px_0px_#000] flex items-center justify-center mb-3">
              <UploadCloud className="w-8 h-8 text-black stroke-[2.5]" />
            </div>
            <h3 className="text-base font-black uppercase text-black m-0">
              Drag & Drop Any Files Here
            </h3>
            <p className="text-xs font-bold text-slate-600 mt-1 mb-4">
              Direct P2P Chunk Streaming • No File Size Limits
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="neo-btn neo-btn-yellow px-5 py-2.5 text-xs font-black uppercase"
            >
              Browse Local Files
            </button>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between pb-3 border-b-2 border-black mb-3">
              <span className="neo-badge bg-[#FFC900] text-black">
                QUEUED ({files.length} • {formatBytes(totalBytes)})
              </span>
              <div className="flex gap-2 text-xs font-bold">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-blue-600 hover:underline cursor-pointer"
                >
                  + Add More
                </button>
                <span>•</span>
                <button
                  onClick={() => onFilesChange([])}
                  className="text-rose-600 hover:underline cursor-pointer"
                >
                  Clear All
                </button>
              </div>
            </div>

            {/* File List */}
            <div className="max-h-40 overflow-y-auto space-y-2 pr-1">
              {files.map((file, idx) => (
                <div
                  key={`${file.name}-${idx}`}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border-2 border-black text-xs shadow-[2px_2px_0px_#000]"
                >
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    {getFileIcon(file)}
                    <span className="truncate max-w-[240px] font-bold text-black">{file.name}</span>
                    <span className="text-[11px] text-slate-500 font-mono font-bold">
                      {formatBytes(file.size)}
                    </span>
                  </div>
                  <button
                    onClick={() => removeFile(idx)}
                    className="p-1 rounded-md hover:bg-rose-100 text-black cursor-pointer"
                  >
                    <X className="w-4 h-4 stroke-[3]" />
                  </button>
                </div>
              ))}
            </div>

            {/* Send CTA */}
            <div className="mt-4 pt-3 border-t-2 border-black flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="text-xs font-bold">
                Target:{' '}
                {targetDevice ? (
                  <span className="neo-badge bg-[#00F59B] text-black ml-1 inline-block">
                    {targetDevice.name}
                  </span>
                ) : (
                  <span className="neo-badge bg-[#FF6B6B] text-white ml-1 inline-block">
                    Select Peer on Radar
                  </span>
                )}
              </div>

              <button
                onClick={onSend}
                disabled={!targetDevice || isTransferring}
                className="neo-btn neo-btn-pink w-full sm:w-auto px-6 py-3 text-xs font-black uppercase disabled:opacity-40"
              >
                <Send className="w-4 h-4 stroke-[3]" />
                <span>{isTransferring ? 'Mogging (Transferring)...' : 'Send Files Now'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
