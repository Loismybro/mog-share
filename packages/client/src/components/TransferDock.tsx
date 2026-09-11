import React, { useState } from 'react';
import { 
  ArrowDownCircle, 
  ArrowUpCircle, 
  CheckCircle2, 
  XCircle, 
  Download, 
  Zap, 
  ChevronUp, 
  ChevronDown 
} from 'lucide-react';
import { TransferFile } from '../types';
import { formatBytes, formatSpeed, formatTime } from '../utils/formatters';
import { sound } from '../utils/audio';

interface TransferDockProps {
  transfers: TransferFile[];
  onCancelTransfer: (id: string) => void;
  onClearCompleted: () => void;
}

export const TransferDock: React.FC<TransferDockProps> = ({
  transfers,
  onCancelTransfer,
  onClearCompleted,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (transfers.length === 0) return null;

  const activeTransfer = transfers.find((t) => t.status === 'transferring');
  const completedCount = transfers.filter((t) => t.status === 'completed').length;

  return (
    <div className="fixed bottom-4 left-4 right-4 max-w-xl mx-auto z-40">
      <div className="neo-box p-4 bg-white border-3 border-black shadow-[6px_6px_0px_#000]">
        
        {/* Header Bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {activeTransfer ? (
              <div className="w-10 h-10 rounded-xl bg-[#FF90E8] border-2 border-black shadow-[2px_2px_0px_#000] flex items-center justify-center">
                {activeTransfer.direction === 'sending' ? (
                  <ArrowUpCircle className="w-6 h-6 text-black stroke-[2.5] animate-bounce" />
                ) : (
                  <ArrowDownCircle className="w-6 h-6 text-black stroke-[2.5] animate-bounce" />
                )}
              </div>
            ) : (
              <div className="w-10 h-10 rounded-xl bg-[#00F59B] border-2 border-black shadow-[2px_2px_0px_#000] flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-black stroke-[2.5]" />
              </div>
            )}

            <div>
              <div className="text-xs font-black uppercase text-black flex items-center gap-2">
                {activeTransfer ? (
                  <>
                    <span>
                      {activeTransfer.direction === 'sending' ? 'Sending to' : 'Receiving from'}{' '}
                      {activeTransfer.peerName}
                    </span>
                    <span className="neo-badge bg-[#FFC900] text-black text-[10px] py-0 px-1">
                      {activeTransfer.progress}%
                    </span>
                  </>
                ) : (
                  <span className="neo-badge bg-[#00F59B] text-black">
                    Transfers Complete ({completedCount})
                  </span>
                )}
              </div>

              {activeTransfer && (
                <div className="text-[11px] font-mono font-bold text-slate-800 flex items-center gap-2 mt-0.5">
                  <span className="flex items-center gap-1 text-[#23A094]">
                    <Zap className="w-3.5 h-3.5 fill-[#23A094]" />
                    {formatSpeed(activeTransfer.speedBytesPerSec)}
                  </span>
                  <span>•</span>
                  <span>ETA {formatTime(activeTransfer.etaSeconds)}</span>
                </div>
              )}
            </div>
          </div>

          <button
            onClick={() => {
              sound.playPop();
              setIsExpanded(!isExpanded);
            }}
            className="neo-btn p-1.5 bg-amber-50 hover:bg-amber-100"
            title="Toggle Queue"
          >
            {isExpanded ? <ChevronDown className="w-4 h-4 stroke-[3]" /> : <ChevronUp className="w-4 h-4 stroke-[3]" />}
          </button>
        </div>

        {/* Striped Progress Bar */}
        {activeTransfer && (
          <div className="mt-3">
            <div className="w-full h-4 rounded-xl bg-slate-100 border-2 border-black overflow-hidden relative shadow-inner">
              <div
                className="h-full bg-[#00F59B] striped-progress transition-all duration-300 border-r-2 border-black"
                style={{ width: `${activeTransfer.progress}%` }}
              />
            </div>
            <div className="flex justify-between items-center text-[10px] font-mono font-bold text-slate-800 mt-1">
              <span className="truncate max-w-[200px]">{activeTransfer.name}</span>
              <span>
                {formatBytes((activeTransfer.size * activeTransfer.progress) / 100)} /{' '}
                {formatBytes(activeTransfer.size)}
              </span>
            </div>
          </div>
        )}

        {/* Expanded History */}
        {isExpanded && (
          <div className="mt-4 pt-3 border-t-2 border-black max-h-48 overflow-y-auto space-y-2">
            <div className="flex justify-between items-center text-xs font-bold text-black mb-1">
              <span className="uppercase font-mono">Transfer Log</span>
              {completedCount > 0 && (
                <button
                  onClick={() => {
                    sound.playPop();
                    onClearCompleted();
                  }}
                  className="text-blue-600 hover:underline cursor-pointer"
                >
                  Clear Finished
                </button>
              )}
            </div>

            {transfers.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border-2 border-black text-xs shadow-[2px_2px_0px_#000]"
              >
                <div className="flex items-center gap-2 min-w-0 pr-2">
                  {item.status === 'completed' && <CheckCircle2 className="w-4 h-4 text-emerald-600 stroke-[2.5]" />}
                  {item.status === 'cancelled' && <XCircle className="w-4 h-4 text-slate-400 stroke-[2.5]" />}
                  {item.status === 'transferring' && <Zap className="w-4 h-4 text-[#FFC900] fill-black animate-bounce" />}
                  
                  <div className="min-w-0">
                    <p className="truncate font-bold text-black m-0">{item.name}</p>
                    <p className="text-[10px] text-slate-600 font-mono font-bold m-0">
                      {formatBytes(item.size)} • {item.direction === 'sending' ? 'To' : 'From'}{' '}
                      {item.peerName}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {item.status === 'completed' && item.blobUrl && (
                    <a
                      href={item.blobUrl}
                      download={item.name}
                      onClick={() => sound.playPop()}
                      className="neo-btn neo-btn-mint p-1.5 text-black"
                      title="Download Received File"
                    >
                      <Download className="w-3.5 h-3.5 stroke-[3]" />
                    </a>
                  )}

                  {item.status === 'transferring' && (
                    <button
                      onClick={() => {
                        sound.playPop();
                        onCancelTransfer(item.id);
                      }}
                      className="p-1 text-slate-500 hover:text-rose-600 cursor-pointer"
                    >
                      <XCircle className="w-4 h-4 stroke-[2.5]" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
