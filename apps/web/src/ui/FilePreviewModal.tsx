import { useState, useRef, useEffect } from 'react';
import {
  Download,
  Share2,
  X,
  ExternalLink,
  Copy,
  Check,
  Play,
  Pause,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  FileText,
  Music,
  Film,
  Image as ImageIcon,
  Box,
  Send,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { formatBytes, formatTime } from '../utils/formatters';
import { openFileWithSystemShare } from '../utils/personalSpace';
import type { Device } from '../types';

export interface PreviewableFile {
  id: string;
  name: string;
  size: number;
  type: string;
  category?: string;
  blobUrl?: string;
  blob?: Blob;
  senderName?: string;
  receivedAt?: number;
}

export function FilePreviewModal(props: {
  file: PreviewableFile;
  peers?: Device[];
  onClose: () => void;
  onSave?: (file: PreviewableFile) => void;
  onDelete?: (id: string) => void;
  onSendToPeer?: (peer: Device, blob: Blob, name: string) => void;
  pushToast: (kind: 'success' | 'error' | 'info', msg: string) => void;
}) {
  const { file, peers = [] } = props;
  const [zoom, setZoom] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showPeerPicker, setShowPeerPicker] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [activeBlobUrl, setActiveBlobUrl] = useState<string | null>(file.blobUrl || null);

  useEffect(() => {
    let createdUrl: string | null = null;
    if (file.blobUrl) {
      setActiveBlobUrl(file.blobUrl);
    } else if (file.blob) {
      try {
        createdUrl = URL.createObjectURL(file.blob);
        setActiveBlobUrl(createdUrl);
      } catch (err) {
        console.warn('Could not create blob URL for preview', err);
      }
    }
    return () => {
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [file.blobUrl, file.blob]);

  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const mime = (file.type || '').toLowerCase();

  const isImage = mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext);
  const isAudio = mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus', 'wma'].includes(ext);
  const isVideo = mime.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext);
  const isPdf = mime.includes('pdf') || ext === 'pdf';
  const isApk = ext === 'apk' || mime.includes('android.package-archive');
  const isText =
    mime.startsWith('text/') ||
    ['txt', 'json', 'md', 'csv', 'log', 'html', 'css', 'js', 'ts', 'jsx', 'tsx', 'py', 'sh', 'xml', 'yaml', 'yml'].includes(ext);

  // Load text content directly from blob or blobUrl
  useEffect(() => {
    if (isText) {
      if (file.blob) {
        file.blob.text()
          .then((t) => setTextContent(t.slice(0, 100_000)))
          .catch(() => setTextContent('Could not read text content'));
      } else if (activeBlobUrl) {
        fetch(activeBlobUrl)
          .then((r) => r.text())
          .then((t) => setTextContent(t.slice(0, 100_000)))
          .catch(() => setTextContent('Could not load text preview'));
      }
    }
  }, [isText, file.blob, activeBlobUrl]);

  // Audio time updates
  const handleAudioTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      setDuration(audioRef.current.duration || 0);
    }
  };

  const togglePlayAudio = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => setIsPlaying(true)).catch((e) => {
        setIsPlaying(false);
        setMediaError('Audio playback restricted by browser. Tap "Open With" or "Save" below.');
      });
    }
  };

  const handleSeek = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleToggleMute = () => {
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const handleDownload = () => {
    if (props.onSave) {
      props.onSave(file);
    } else {
      const url = activeBlobUrl || (file.blob ? URL.createObjectURL(file.blob) : null);
      if (url) {
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    }
    props.pushToast('success', `Saved ${file.name}`);
  };

  const handleSystemShare = async () => {
    let blobToShare = file.blob;
    if (!blobToShare && activeBlobUrl) {
      try {
        const res = await fetch(activeBlobUrl);
        blobToShare = await res.blob();
      } catch {
        /* Ignore */
      }
    }

    if (blobToShare) {
      const ok = await openFileWithSystemShare(blobToShare, file.name, file.type);
      if (ok) {
        props.pushToast('success', 'Shared with system app');
        return;
      }
    }

    // Fallback: Open in new window or trigger browser download
    const url = activeBlobUrl || (blobToShare ? URL.createObjectURL(blobToShare) : null);
    if (url) {
      const win = window.open(url, '_blank');
      if (!win) {
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        props.pushToast('info', `Saved ${file.name} to device`);
      } else {
        props.pushToast('info', 'Opened in browser window');
      }
    }
  };

  const handleCopyText = async () => {
    if (textContent) {
      try {
        await navigator.clipboard.writeText(textContent);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        props.pushToast('success', 'Text copied to clipboard');
      } catch {
        props.pushToast('error', 'Copy failed');
      }
    }
  };

  const handleSendToSelectedPeer = (peer: Device) => {
    if (!props.onSendToPeer || !file.blob) return;
    props.onSendToPeer(peer, file.blob, file.name);
    setShowPeerPicker(false);
    props.pushToast('success', `Sending ${file.name} to ${peer.name}`);
  };

  return (
    <div className="modal-overlay" onClick={props.onClose}>
      <div className="modal card preview-modal" role="dialog" aria-label={`Preview ${file.name}`} onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-head preview-head">
          <div className="preview-header-meta">
            <span className="badge badge-category">{file.category?.toUpperCase() || 'FILE'}</span>
            <h2 className="preview-title" title={file.name}>{file.name}</h2>
            <span className="muted mono small">
              {formatBytes(file.size)}
              {file.senderName && ` · From ${file.senderName}`}
              {file.receivedAt && ` · ${new Date(file.receivedAt).toLocaleTimeString()}`}
            </span>
          </div>
          <button className="icon-btn brutal-btn-icon" onClick={props.onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Modal Body / Viewer Content */}
        <div className="preview-body">
          {/* 1. Image Viewer */}
          {isImage && activeBlobUrl && (
            <div className="image-viewer-wrap">
              <div className="image-viewport">
                <img
                  src={activeBlobUrl}
                  alt={file.name}
                  className="preview-image"
                  style={{ transform: `scale(${zoom})` }}
                />
              </div>
              <div className="image-controls">
                <button
                  className="btn btn-brutal btn-xs"
                  onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}
                  title="Zoom Out"
                >
                  <ZoomOut size={14} />
                </button>
                <span className="mono small font-bold">{Math.round(zoom * 100)}%</span>
                <button
                  className="btn btn-brutal btn-xs"
                  onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}
                  title="Zoom In"
                >
                  <ZoomIn size={14} />
                </button>
                <button
                  className="btn btn-brutal btn-xs"
                  onClick={() => setZoom(1)}
                  title="Reset Zoom"
                >
                  <RotateCcw size={14} />
                </button>
              </div>
            </div>
          )}

          {/* 2. Audio Player */}
          {isAudio && activeBlobUrl && (
            <div className="audio-player-card">
              <audio
                ref={audioRef}
                src={activeBlobUrl}
                onTimeUpdate={handleAudioTimeUpdate}
                onEnded={() => setIsPlaying(false)}
                onLoadedMetadata={handleAudioTimeUpdate}
                onError={() => setMediaError('Format not supported by browser audio engine. Tap "Open With" or "Save" below to play in system media player.')}
              />
              <div className="audio-artwork-box">
                <Music size={44} className="audio-hero-icon" />
                <div className={`audio-equalizer ${isPlaying ? 'playing' : ''}`}>
                  <span className="eq-bar bar-1"></span>
                  <span className="eq-bar bar-2"></span>
                  <span className="eq-bar bar-3"></span>
                  <span className="eq-bar bar-4"></span>
                  <span className="eq-bar bar-5"></span>
                </div>
              </div>

              <div className="audio-details">
                <div className="audio-title-line font-bold">{file.name}</div>
                <div className="muted small mono">{formatBytes(file.size)} · Audio Stream</div>
                {mediaError && <p className="warn-text small">{mediaError}</p>}
              </div>

              {/* Progress Scrubber */}
              <div className="audio-scrub-row">
                <span className="mono small">{formatTime(Math.floor(currentTime))}</span>
                <input
                  type="range"
                  className="audio-slider"
                  min={0}
                  max={duration || 100}
                  step={0.1}
                  value={currentTime}
                  onChange={(e) => handleSeek(Number(e.target.value))}
                />
                <span className="mono small">{formatTime(Math.floor(duration))}</span>
              </div>

              {/* Controls */}
              <div className="audio-btn-row">
                <button
                  className="btn btn-brutal btn-circle-lg play-pause-btn"
                  onClick={togglePlayAudio}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? <Pause size={24} /> : <Play size={24} style={{ marginLeft: 3 }} />}
                </button>

                <div className="audio-vol-wrap">
                  <button className="icon-btn brutal-btn-icon" onClick={handleToggleMute} aria-label="Mute">
                    {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                  </button>
                  <input
                    type="range"
                    className="vol-slider"
                    min={0}
                    max={1}
                    step={0.05}
                    value={isMuted ? 0 : volume}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setVolume(v);
                      if (audioRef.current) {
                        audioRef.current.volume = v;
                        audioRef.current.muted = false;
                      }
                      setIsMuted(false);
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* 3. Video Player */}
          {isVideo && activeBlobUrl && (
            <div className="video-player-card">
              <video
                ref={videoRef}
                src={activeBlobUrl}
                controls
                playsInline
                className="preview-video"
                onError={() => setMediaError('Video codec not directly playable in browser. Tap "Open With" or "Save" below to launch VLC / video player.')}
              />
              {mediaError && <p className="warn-text small p-2">{mediaError}</p>}
            </div>
          )}

          {/* 4. Text / Code Viewer */}
          {isText && (
            <div className="text-viewer-card">
              <div className="text-viewer-toolbar">
                <span className="mono small font-bold">PREVIEW ({ext.toUpperCase() || 'TEXT'})</span>
                <button className="btn btn-brutal btn-xs" onClick={handleCopyText}>
                  {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy Text</>}
                </button>
              </div>
              <pre className="text-viewer-pre mono">
                {textContent !== null ? textContent : 'Loading text…'}
              </pre>
            </div>
          )}

          {/* 5. PDF Viewer */}
          {isPdf && activeBlobUrl && (
            <div className="pdf-viewer-card">
              <iframe src={activeBlobUrl} title={file.name} className="pdf-iframe" />
            </div>
          )}

          {/* 6. APK / App Package Inspector */}
          {isApk && (
            <div className="inspector-card apk-inspector">
              <div className="inspector-icon-wrap pale-mint-bg">
                <Box size={48} className="apk-hero-icon" />
              </div>
              <div className="inspector-content">
                <h3 className="inspector-title font-bold">Android Application Package (.apk)</h3>
                <p className="inspector-desc muted">
                  This is an Android app installer file. Tap "Install / Open With" to launch the native Android Package Installer.
                </p>
                <div className="inspector-meta-grid mono small">
                  <div className="meta-cell"><span>Package:</span> <strong>{file.name}</strong></div>
                  <div className="meta-cell"><span>Size:</span> <strong>{formatBytes(file.size)}</strong></div>
                  <div className="meta-cell"><span>Format:</span> <strong>Dalvik Executable / APK</strong></div>
                </div>
                <p className="warn-text small">
                  <AlertTriangle size={13} /> Only install apps from trusted peers.
                </p>
              </div>
            </div>
          )}

          {/* 7. Generic Binary / Archive Inspector */}
          {!isImage && !isAudio && !isVideo && !isText && !isPdf && !isApk && (
            <div className="inspector-card generic-inspector">
              <div className="inspector-icon-wrap pale-lavender-bg">
                {file.category === 'archives' ? <Box size={44} /> : <FileText size={44} />}
              </div>
              <div className="inspector-content">
                <h3 className="inspector-title font-bold">{file.name}</h3>
                <p className="inspector-desc muted">
                  Binary / Document file ready to open with your system's default application or download.
                </p>
                <div className="inspector-meta-grid mono small">
                  <div className="meta-cell"><span>Type:</span> <strong>{file.type || 'application/octet-stream'}</strong></div>
                  <div className="meta-cell"><span>Size:</span> <strong>{formatBytes(file.size)}</strong></div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Actions Footer */}
        <div className="modal-actions preview-actions">
          <div className="actions-left">
            {props.onDelete && (
              <button
                className="btn btn-brutal btn-danger-brutal btn-sm"
                onClick={() => props.onDelete!(file.id)}
                title="Delete from space"
              >
                <Trash2 size={15} /> Delete
              </button>
            )}
            {peers.length > 0 && props.onSendToPeer && file.blob && (
              <div className="resend-dropdown-wrap">
                <button
                  className="btn btn-brutal btn-pale-yellow btn-sm"
                  onClick={() => setShowPeerPicker(!showPeerPicker)}
                >
                  <Send size={15} /> Send to…
                </button>
                {showPeerPicker && (
                  <div className="peer-picker-menu">
                    <p className="muted small font-bold" style={{ margin: '4px 8px' }}>Send to online peer:</p>
                    {peers.map((p) => (
                      <button
                        key={p.id}
                        className="peer-picker-item"
                        onClick={() => handleSendToSelectedPeer(p)}
                      >
                        <strong>{p.name}</strong>
                        <span className="muted small">({p.platform})</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="actions-right">
            {activeBlobUrl && (
              <button
                className="btn btn-brutal btn-ghost-brutal btn-sm"
                onClick={() => window.open(activeBlobUrl, '_blank')}
                title="Open raw file in new browser tab"
              >
                <ExternalLink size={15} /> Tab
              </button>
            )}
            <button
              className="btn btn-brutal btn-pale-cyan btn-sm"
              onClick={handleSystemShare}
              title="Open with system application (e.g. VLC, Gallery, Package Installer)"
            >
              <Share2 size={15} /> Open With…
            </button>
            <button
              className="btn btn-brutal btn-primary-brutal btn-sm"
              onClick={handleDownload}
            >
              <Download size={15} /> Save / Download
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
