import React, { useState, useEffect } from 'react';
import AnimatedDots from './AnimatedDots';

const THUMBNAIL_MODELS = [
  { id: 'cheap', label: 'Cheap (Gemini 2.5 Flash Image)' },
  { id: 'expensive', label: 'Expensive (Gemini 3 Pro Image)' },
];

export default function YouTubeMetadata({
  scriptSummary,
  sceneImageBlobs,
  onGenerateTitle,
  onGenerateDescription,
  onGenerateThumbnail,
  title,
  description,
  thumbnailBlob,
  titleLoading,
  descriptionLoading,
  thumbnailLoading,
}) {
  const [thumbnailUrl, setThumbnailUrl] = useState(null);
  const [thumbnailModel, setThumbnailModel] = useState('cheap');

  useEffect(() => {
    if (thumbnailBlob) {
      const url = URL.createObjectURL(thumbnailBlob);
      setThumbnailUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setThumbnailUrl(null);
  }, [thumbnailBlob]);

  const handleGenerateThumbnail = () => {
    const modelId = thumbnailModel === 'expensive' ? 'expensive' : 'cheap';
    onGenerateThumbnail?.(modelId);
  };

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-slate-200">YouTube Metadata</h3>

      <div>
        <label className="block text-slate-400 text-sm mb-1">Title</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={title}
            readOnly
            className="flex-1 px-3 py-2 rounded bg-slate-800 border border-slate-600 text-slate-200 text-sm"
            placeholder="Generate a title..."
          />
          <button
            type="button"
            onClick={onGenerateTitle}
            disabled={titleLoading || !scriptSummary?.trim()}
            className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white text-sm whitespace-nowrap"
          >
            {titleLoading ? <AnimatedDots prefix="Generating" /> : 'Generate Title'}
          </button>
        </div>
      </div>

      <div>
        <label className="block text-slate-400 text-sm mb-1">Description</label>
        <div className="flex gap-2 items-start">
          <textarea
            value={description}
            readOnly
            rows={4}
            className="flex-1 px-3 py-2 rounded bg-slate-800 border border-slate-600 text-slate-200 text-sm resize-y min-h-[80px]"
            placeholder="Generate a description..."
          />
          <button
            type="button"
            onClick={onGenerateDescription}
            disabled={descriptionLoading || !scriptSummary?.trim()}
            className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white text-sm whitespace-nowrap"
          >
            {descriptionLoading ? <AnimatedDots prefix="Generating" /> : 'Generate Description'}
          </button>
        </div>
      </div>

      <div>
        <label className="block text-slate-400 text-sm mb-1">Thumbnail</label>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={thumbnailModel}
            onChange={(e) => setThumbnailModel(e.target.value)}
            className="px-2 py-1 rounded bg-slate-700 border border-slate-600 text-slate-200 text-sm"
          >
            {THUMBNAIL_MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleGenerateThumbnail}
            disabled={thumbnailLoading || !scriptSummary?.trim()}
            className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white text-sm"
          >
            {thumbnailLoading ? <AnimatedDots prefix="Generating" /> : 'Generate Image'}
          </button>
        </div>
        {thumbnailUrl && (
          <div className="mt-2">
            <img src={thumbnailUrl} alt="YouTube thumbnail" className="max-w-xs rounded border border-slate-600 object-cover" />
          </div>
        )}
      </div>
    </div>
  );
}
