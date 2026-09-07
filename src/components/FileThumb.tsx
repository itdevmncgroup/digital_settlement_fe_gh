'use client';

import { useEffect, useState } from 'react';
import { fetchAuthedBlobUrl } from '@/lib/api';
import Modal from './Modal';
import ZoomableImage from './ZoomableImage';

interface FileThumbProps {
  /** Authenticated download endpoint, e.g. /expenses/photos/:id/download */
  path: string;
  fileName: string;
  isImage: boolean;
}

// Already-uploaded file (photo or invoice) fetched via an authenticated
// endpoint: shows an actual thumbnail for images, a document icon otherwise.
// Clicking an image opens it full-size in a zoomable popup; a non-image opens
// in a new tab for viewing (not a forced download).
export default function FileThumb({ path, fileName, isImage }: FileThumbProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    fetchAuthedBlobUrl(path)
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        objectUrl = u;
        setUrl(u);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  const thumb = (
    <div
      style={{
        width: 72,
        height: 72,
        borderRadius: 6,
        border: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        background: 'var(--input-bg)',
        fontSize: 22,
      }}
    >
      {isImage && url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={fileName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : failed ? (
        '⚠️'
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
      {fileName}
    </span>
  );

  return (
    <>
      {isImage ? (
        <button
          type="button"
          onClick={() => setShowPreview(true)}
          disabled={!url}
          title={`Preview ${fileName}`}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
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
          onClick={(e) => {
            if (!url) e.preventDefault();
          }}
          title={fileName}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            width: 84,
            textAlign: 'center',
            cursor: url ? 'pointer' : 'default',
          }}
        >
          {thumb}
          {label}
        </a>
      )}
      {showPreview && url && (
        <Modal title={fileName} onClose={() => setShowPreview(false)} wide>
          <ZoomableImage src={url} alt={fileName} />
        </Modal>
      )}
    </>
  );
}
