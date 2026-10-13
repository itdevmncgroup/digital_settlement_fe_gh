'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import LocalFileThumb from './LocalFileThumb';

interface CameraCaptureModalProps {
  title: string;
  /** Called with every frame taken once the user presses Done. */
  onDone: (files: File[]) => void;
  onClose: () => void;
}

// Desktop webcam capture (getUserMedia) - the `capture` attribute on a file
// input only opens the camera on phones; on a desktop browser it just shows the
// normal file dialog. Several shots can be taken in one session. Needs a secure
// context (HTTPS or localhost) and the browser's camera permission.
export default function CameraCaptureModal({ title, onDone, onClose }: CameraCaptureModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [shots, setShots] = useState<File[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('Camera needs a secure (HTTPS) connection and a browser that supports it - use the file upload instead.');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch((err: DOMException) =>
        setError(
          err.name === 'NotAllowedError'
            ? 'Camera permission is blocked - allow it in the browser/site settings, then reopen.'
            : err.name === 'NotFoundError'
            ? 'No camera found on this device - use the file upload instead.'
            : 'Could not start the camera - use the file upload instead.',
        ),
      );
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
        setShots((prev) => [...prev, new File([blob], `camera-${stamp}-${prev.length + 1}.jpg`, { type: 'image/jpeg' })]);
      },
      'image/jpeg',
      0.85,
    );
  }, []);

  return (
    <Modal title={title} onClose={onClose} wide>
      {error ? (
        <div className="error-text">{error}</div>
      ) : (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onLoadedMetadata={() => setReady(true)}
          style={{ width: '100%', maxHeight: '60vh', background: '#000', borderRadius: 8 }}
        />
      )}

      {shots.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
          {shots.map((f, i) => (
            <LocalFileThumb key={f.name} file={f} onRemove={() => setShots((prev) => prev.filter((_, idx) => idx !== i))} />
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" className="btn btn-primary" disabled={!ready || !!error} onClick={capture}>
          📷 Take photo
        </button>
        <button type="button" className="btn" disabled={shots.length === 0} onClick={() => onDone(shots)}>
          Done ({shots.length})
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
