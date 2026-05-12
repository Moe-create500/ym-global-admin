'use client';

export interface CloneAdFormProps {
  referenceVideoUrl: string;
  setReferenceVideoUrl: React.Dispatch<React.SetStateAction<string>>;
  referenceVideoFile: File | null;
  setReferenceVideoFile: React.Dispatch<React.SetStateAction<File | null>>;
  ingestMode: 'url' | 'upload';
  setIngestMode: React.Dispatch<React.SetStateAction<'url' | 'upload'>>;
  cloneAdOutputMode: 'standard' | 'tutorial';
  setCloneAdOutputMode: React.Dispatch<React.SetStateAction<'standard' | 'tutorial'>>;
}

export function CloneAdForm({
  referenceVideoUrl,
  setReferenceVideoUrl,
  referenceVideoFile,
  setReferenceVideoFile,
  ingestMode,
  setIngestMode,
  cloneAdOutputMode,
  setCloneAdOutputMode,
}: CloneAdFormProps) {
  return (
    <div className="mt-3 bg-pink-950/20 border border-pink-900/40 rounded-lg p-3 space-y-2">
      <label className="text-[10px] text-pink-400 uppercase font-bold block">Reference Video</label>

      {/* Tab toggle: Paste URL | Upload File */}
      <div className="flex gap-1 bg-slate-900/60 rounded-lg p-1">
        <button
          type="button"
          onClick={() => {
            setIngestMode('url');
            setReferenceVideoFile(null);
          }}
          className={`flex-1 px-3 py-1.5 rounded text-[10px] font-semibold transition-colors ${
            ingestMode === 'url'
              ? 'bg-pink-600 text-white'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Paste URL
        </button>
        <button
          type="button"
          onClick={() => {
            setIngestMode('upload');
            setReferenceVideoUrl('');
          }}
          className={`flex-1 px-3 py-1.5 rounded text-[10px] font-semibold transition-colors ${
            ingestMode === 'upload'
              ? 'bg-pink-600 text-white'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Upload File
        </button>
      </div>

      {ingestMode === 'url' ? (
        <>
          <p className="text-[9px] text-slate-400">
            Paste a direct video URL (MP4, MOV, WebM). The system will analyze each scene frame-by-frame and generate Seedance-optimized prompts that clone the ad&apos;s structure.
          </p>
          <input
            type="url"
            value={referenceVideoUrl}
            onChange={e => setReferenceVideoUrl(e.target.value)}
            placeholder="https://example.com/winning-ad.mp4"
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-600"
          />
          <p className="text-[9px] text-pink-400/60">
            Tip: Use a direct video link — not YouTube. You can use URLs from your Generated tab, fal.media links, or any public .mp4 URL.
          </p>
        </>
      ) : (
        <>
          <p className="text-[9px] text-slate-400">
            Upload MP4, MOV, or WebM. No size limit (2GB ceiling for safety). The file is processed in a temp directory and deleted after analysis — no permanent storage in Stage A1.
          </p>
          <input
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/x-msvideo"
            onChange={e => setReferenceVideoFile(e.target.files?.[0] ?? null)}
            className="w-full text-[10px] text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-pink-600 file:text-white file:font-semibold file:cursor-pointer file:text-[10px] hover:file:bg-pink-700"
          />
          {referenceVideoFile && (
            <p className="text-[9px] text-emerald-400">
              Selected: {referenceVideoFile.name} ({(referenceVideoFile.size / 1_000_000).toFixed(1)} MB)
            </p>
          )}
          <p className="text-[9px] text-pink-400/60">
            Tip: For YouTube/TikTok/Reels videos, download the file first (use a browser extension or yt-dlp on your machine), then upload here. Stage A2 will add direct URL support for those platforms.
          </p>
        </>
      )}

      {/* Output Mode toggle — Standard (3 prompt packages) vs Tutorial (direct Seedance video) */}
      <div className="pt-2 mt-1 border-t border-pink-900/40">
        <label className="text-[10px] text-pink-400 uppercase font-bold block mb-1.5">Output Mode</label>
        <div className="flex gap-1 bg-slate-900/60 rounded-lg p-1">
          <button
            type="button"
            onClick={() => setCloneAdOutputMode('standard')}
            className={`flex-1 px-3 py-1.5 rounded text-[10px] font-semibold transition-colors ${
              cloneAdOutputMode === 'standard'
                ? 'bg-pink-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Standard packages
          </button>
          <button
            type="button"
            onClick={() => setCloneAdOutputMode('tutorial')}
            className={`flex-1 px-3 py-1.5 rounded text-[10px] font-semibold transition-colors ${
              cloneAdOutputMode === 'tutorial'
                ? 'bg-pink-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Tutorial Mode (direct video)
          </button>
        </div>
        <p className="text-[9px] text-slate-400 mt-1.5">
          {cloneAdOutputMode === 'standard'
            ? 'Generates 3 Seedance-ready prompt packages for you to review, edit, and queue manually.'
            : 'Generates one finished video directly using Higgsfield Seedance 2.0 with frame_0 as reference. Takes 6–10 min. Source video duration will be clamped to 3–12 seconds (Higgsfield Seedance limit).'}
        </p>
      </div>
    </div>
  );
}
