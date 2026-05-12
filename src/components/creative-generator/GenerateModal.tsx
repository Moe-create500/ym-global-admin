'use client';

import type { UseGenerateModalStateReturn } from './hooks/useGenerateModalState';

export interface GenerateModalProps {
  generateModal: UseGenerateModalStateReturn;
  storeFilter: string;
  onGenerate: () => void;
}

export function GenerateModal({ generateModal, storeFilter, onGenerate }: GenerateModalProps) {
  const {
    showGenerate, setShowGenerate,
    genType, setGenType,
    genPrompt, setGenPrompt,
    genTitle, setGenTitle,
    genAngle, setGenAngle,
    genImageUrls, setGenImageUrls,
    genEngine, setGenEngine,
    genResolution, setGenResolution,
    genDuration, setGenDuration,
    generating,
    genResult,
    prefillAdName,
  } = generateModal;

  if (!showGenerate) return null;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) setShowGenerate(false); }}>
      <div className="bg-slate-900 border border-purple-900/50 rounded-xl p-5 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-white">
          Generate Video
          {prefillAdName && <span className="text-purple-400 font-normal ml-2">Based on: {prefillAdName}</span>}
        </h2>
        <button onClick={() => setShowGenerate(false)} className="text-slate-400 hover:text-white text-sm">Close</button>
      </div>

      {/* Engine selector */}
      <div className="flex flex-wrap gap-1 bg-slate-800 p-0.5 rounded-lg w-full sm:w-fit mb-4 overflow-x-auto">
        {([
          { key: 'sora', label: 'Sora (OpenAI)', sub: 'Video' },
          { key: 'veo', label: 'Veo (Google)', sub: 'Video' },
          { key: 'minimax', label: 'Hailuo (MiniMax)', sub: 'Video' },
          { key: 'minimax-image', label: 'MiniMax Image', sub: 'Image' },
          { key: 'nanobanana', label: 'NanoBanana', sub: 'Video' },
        ] as const).map(eng => (
          <button
            key={eng.key}
            onClick={() => setGenEngine(eng.key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              genEngine === eng.key ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            {eng.label}
            <span className={`ml-1 text-[9px] ${genEngine === eng.key ? 'text-purple-200' : 'text-slate-600'}`}>
              {eng.sub}
            </span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        {(genEngine === 'nanobanana' || genEngine === 'minimax' || genEngine === 'sora' || genEngine === 'veo') && (
          <div>
            <label className="block text-[10px] text-slate-500 uppercase mb-1">Type</label>
            <select
              value={genType}
              onChange={(e) => setGenType(e.target.value as any)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
            >
              <option value="text-to-video">Text to Video</option>
              <option value="image-to-video">Image to Video</option>
            </select>
          </div>
        )}
        <div>
          <label className="block text-[10px] text-slate-500 uppercase mb-1">
            {genEngine === 'minimax-image' ? 'Aspect Ratio' : genEngine === 'sora' ? 'Size' : genEngine === 'veo' ? 'Resolution / Aspect' : 'Resolution'}
          </label>
          <select
            value={genResolution}
            onChange={(e) => setGenResolution(e.target.value)}
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
          >
            {genEngine === 'sora' ? (
              <>
                <option value="720p">1280x720 Landscape</option>
                <option value="720p-vertical">720x1280 Portrait</option>
                <option value="1080p">1920x1080 HD (Pro)</option>
                <option value="1080p-vertical">1080x1920 HD Portrait (Pro)</option>
              </>
            ) : genEngine === 'veo' ? (
              <>
                <option value="720p">720p Landscape (Fast)</option>
                <option value="720p-vertical">720p Portrait (Fast)</option>
                <option value="1080p">1080p Landscape</option>
                <option value="1080p-vertical">1080p Portrait</option>
                <option value="4k">4K Landscape</option>
              </>
            ) : genEngine === 'minimax' ? (
              <>
                <option value="1080P">1080P</option>
                <option value="720P">720P</option>
              </>
            ) : genEngine === 'minimax-image' ? (
              <>
                <option value="16:9">16:9 Landscape</option>
                <option value="9:16">9:16 Portrait</option>
                <option value="1:1">1:1 Square</option>
                <option value="4:3">4:3 Standard</option>
                <option value="3:4">3:4 Tall</option>
              </>
            ) : (
              <>
                <option value="480p">480p (5 credits)</option>
                <option value="720p">720p (5 credits)</option>
                <option value="1080p">1080p (7 credits)</option>
              </>
            )}
          </select>
        </div>
        {genEngine !== 'minimax-image' && (
          <div>
            <label className="block text-[10px] text-slate-500 uppercase mb-1">Duration</label>
            {genEngine === 'sora' ? (
              <select
                value={genDuration}
                onChange={(e) => setGenDuration(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
              >
                <option value="8">8 seconds</option>
                <option value="16">16 seconds</option>
                <option value="20">20 seconds</option>
              </select>
            ) : genEngine === 'veo' ? (
              <select
                value={genDuration}
                onChange={(e) => setGenDuration(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
              >
                <option value="4">4 seconds</option>
                <option value="6">6 seconds</option>
                <option value="8">8 seconds</option>
              </select>
            ) : genEngine === 'minimax' ? (
              <select
                value={genDuration}
                onChange={(e) => setGenDuration(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
              >
                <option value="6">6 seconds</option>
                <option value="5">5 seconds</option>
              </select>
            ) : (
              <input
                type="number"
                min="3" max="12"
                value={genDuration}
                onChange={(e) => setGenDuration(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
              />
            )}
          </div>
        )}
        <div>
          <label className="block text-[10px] text-slate-500 uppercase mb-1">Angle / Hook</label>
          <input
            type="text"
            placeholder="e.g. UGC testimonial"
            value={genAngle}
            onChange={(e) => setGenAngle(e.target.value)}
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
          />
        </div>
      </div>
      <div className="mb-4">
        <label className="block text-[10px] text-slate-500 uppercase mb-1">Title</label>
        <input
          type="text"
          value={genTitle}
          onChange={(e) => setGenTitle(e.target.value)}
          placeholder="Creative title"
          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
        />
      </div>
      <div className="mb-4">
        <label className="block text-[10px] text-slate-500 uppercase mb-1">Prompt</label>
        <textarea
          value={genPrompt}
          onChange={(e) => setGenPrompt(e.target.value)}
          rows={3}
          placeholder="Describe the video you want to generate..."
          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500 resize-none"
        />
      </div>
      {genType === 'image-to-video' && (genEngine === 'sora' || genEngine === 'veo' || genEngine === 'minimax' || genEngine === 'nanobanana') && (
        <div className="mb-4">
          <label className="block text-[10px] text-slate-500 uppercase mb-1">Image URLs (one per line)</label>
          <textarea
            value={genImageUrls}
            onChange={(e) => setGenImageUrls(e.target.value)}
            rows={2}
            placeholder="https://example.com/image1.jpg"
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500 resize-none"
          />
          {genEngine === 'sora' && (
            <p className="mt-1 text-[10px] text-slate-500">
              Sora uses the first image as the locked product reference frame. Use a clean front-facing product image for the most exact match.
            </p>
          )}
        </div>
      )}
      <div className="flex items-center gap-3">
        <button
          onClick={onGenerate}
          disabled={!storeFilter || !genPrompt || !genTitle || generating}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
        >
          {generating ? 'Generating...' : `Generate with ${
            genEngine === 'sora' ? 'Sora' : genEngine === 'veo' ? 'Veo'
            : genEngine === 'minimax' ? 'Hailuo' : genEngine === 'minimax-image' ? 'MiniMax Image'
            : 'NanoBanana'
          }`}
        </button>
        {!storeFilter && <span className="text-xs text-yellow-400">Select a store first</span>}
        {genResult && (
          <span className={`text-xs ${genResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
            {genResult.success
              ? genResult.engine === 'sora'
                ? `Sora video queued! Model: ${genResult.model}, ${genResult.seconds}s`
                : genResult.engine === 'veo'
                ? `Veo video queued! Model: ${genResult.model}`
                : genResult.engine === 'minimax'
                ? `Hailuo video queued! Model: ${genResult.model}`
                : genResult.engine === 'minimax-image'
                ? `Image generated!`
                : `Video queued! Credits used: ${genResult.creditsUsed}`
              : genResult.error}
          </span>
        )}
      </div>
    </div>
    </div>
  );
}
