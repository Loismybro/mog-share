import React from 'react';

export const TacticalBackground: React.FC = () => {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
      {/* Soft Ambient Radial Vignette */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-blue-950/20 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-[600px] h-[400px] bg-slate-900/40 rounded-full blur-[120px] pointer-events-none" />

      {/* Floating Geometric Wireframe Shape 1 - Top Left */}
      <div className="absolute top-24 -left-12 w-64 h-64 border-2 border-dashed border-zinc-800/60 rounded-3xl rotate-12 animate-float-slow opacity-40">
        <div className="w-full h-full border border-zinc-700/30 rounded-2xl m-3" />
      </div>

      {/* Floating Geometric Wireframe Shape 2 - Top Right */}
      <div className="absolute top-40 -right-16 w-72 h-72 border-2 border-zinc-800/50 rounded-full animate-float-reverse opacity-30">
        <div className="w-48 h-48 border border-dashed border-zinc-700/40 rounded-full m-12 flex items-center justify-center">
          <span className="text-[10px] font-mono font-bold text-zinc-600 tracking-widest uppercase">
            [P2P.MESH]
          </span>
        </div>
      </div>

      {/* Geometric Floating Shape 3 - Mid Left */}
      <div className="hidden lg:block absolute top-[55%] left-10 w-36 h-36 border-2 border-zinc-800/40 rotate-45 animate-float-reverse opacity-30">
        <div className="w-16 h-16 border border-zinc-700/40 m-10" />
      </div>

      {/* Decorative Technical Crosshairs and Corner Brackets */}
      <div className="absolute top-16 left-8 font-mono text-[11px] text-zinc-600/80 select-none">
        <span className="text-zinc-500 font-bold">+</span> 01_TX // MESH_NODE
      </div>
      <div className="absolute top-16 right-8 font-mono text-[11px] text-zinc-600/80 select-none text-right">
        [SYS.SECURE_TUNNEL] <span className="text-zinc-500 font-bold">+</span>
      </div>
      <div className="hidden sm:block absolute bottom-12 left-10 font-mono text-[10px] text-zinc-600/60 select-none">
        [COORD: 40.7128° N, 74.0060° W]
      </div>
      <div className="hidden sm:block absolute bottom-12 right-10 font-mono text-[10px] text-zinc-600/60 select-none text-right">
        [ENC: X25519 // DTLS-SRTP]
      </div>
    </div>
  );
};
