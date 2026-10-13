'use client';

import { useState } from 'react';
import CameraCaptureModal from './CameraCaptureModal';

interface FileOrCameraInputProps {
  accept: string;
  /** Receives the picked or captured files; the caller owns them from here. */
  onFiles: (files: File[]) => void;
  cameraTitle?: string;
  disabled?: boolean;
}

// Native file picker plus a "Use Camera" button that opens a webcam capture
// popup - for desktop pages, where the plain `capture` attribute does nothing.
export default function FileOrCameraInput({ accept, onFiles, cameraTitle = 'Take photo', disabled }: FileOrCameraInputProps) {
  const [showCamera, setShowCamera] = useState(false);
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <input
        type="file"
        accept={accept}
        multiple
        disabled={disabled}
        style={{ width: 'auto' }}
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
      <button type="button" className="btn" disabled={disabled} onClick={() => setShowCamera(true)}>
        📷 Use Camera
      </button>
      {showCamera && (
        <CameraCaptureModal
          title={cameraTitle}
          onClose={() => setShowCamera(false)}
          onDone={(files) => {
            setShowCamera(false);
            onFiles(files);
          }}
        />
      )}
    </div>
  );
}
