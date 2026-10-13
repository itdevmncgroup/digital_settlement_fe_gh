'use client';

import { useEffect, useState } from 'react';
import Modal from './Modal';
import ZoomableImage from './ZoomableImage';

interface LocalFileThumbProps {
  file: File;
  onRemove?: () => void;
}

// A locally-picked File not yet uploaded - lets the user see what they've
// staged for upload before submitting the form. Clicking an image opens it
// full-size in a zoomable popup; a non-image opens in a new tab.
export default function LocalFileThumb({ file, onRemove }: LocalFileThumbProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const isImage = file.type.startsWith('image/');

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const thumb = (
    <div
      style={{
        width: 80,
        height: 80,
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        background: 'var(--surface-2)',
        boxShadow: 'var(--shadow-sm)',
        fontSize: 24,
      }}
    >
      {isImage && url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={file.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        '📄'
      )}
    </div>
  );

  const label = (
    <span
      style={{
        fontSize: 11,
        color: 'var(--muted)',
        maxWidth: 84,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {file.name}
    </span>
  );

  return (
    <div style={{ position: 'relative', width: 84 }}>
      {isImage ? (
        <button
          type="button"
          onClick={() => setShowPreview(true)}
          disabled={!url}
          title={`Preview ${file.name}`}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            width: 84,
            textAlign: 'center',
            cursor: url ? 'pointer' : 'default',
            border: 'none',
            background: 'none',
            padding: 0,
          }}
        >
          {thumb}
          {label}
        </button>
      ) : (
        <a
          href={url ?? undefined}
          target="_blank"
          rel="noreferrer"
          title={file.name}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textAlign: 'center' }}
        >
          {thumb}
          {label}
        </a>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${file.name}`}
          style={{
            position: 'absolute',
            top: -8,
            right: -8,
            width: 24,
            height: 24,
            borderRadius: '50%',
            border: '2px solid var(--surface)',
            background: 'var(--danger)',
            color: '#fff',
            fontSize: 14,
            lineHeight: '20px',
            padding: 0,
            cursor: 'pointer',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          ×
        </button>
      )}
      {showPreview && url && (
        <Modal title={file.name} onClose={() => setShowPreview(false)} wide>
          <ZoomableImage src={url} alt={file.name} />
        </Modal>
      )}
    </div>
  );
}
