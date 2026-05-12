'use client';

import type { GeneratorConfig, Product, Store } from '@/components/creative-generator/types';
import type { SetGenConfig } from './hooks/useGeneratorState';
import { ENGINE_METADATA } from '@/lib/engine-metadata';
import type { UseGeneratorTabStateReturn } from './hooks/useGeneratorTabState';
import { ContentTypeSelector } from './ContentTypeSelector';
import { EngineSelector } from './EngineSelector';
import { AnimatedStyleSelector } from './AnimatedStyleSelector';
import { HiggsfieldStylePresets } from './HiggsfieldStylePresets';
import { OutputStrategySelector } from './OutputStrategySelector';
import { StageFocusSelector } from './StageFocusSelector';
import { ContentMixSelector } from './ContentMixSelector';
import { ConceptsCount } from './ConceptsCount';
import { VariationsCount } from './VariationsCount';
import { HookStyleSelector } from './HookStyleSelector';
import { PresenterSelector } from './PresenterSelector';
import { VideoDurationSelector } from './VideoDurationSelector';
import { AspectRatioSelector } from './AspectRatioSelector';
import { PlatformSelector } from './PlatformSelector';
import { OfferInput } from './OfferInput';
import { ConceptSourceSelector } from './ConceptSourceSelector';
import { GenModeSelector } from './GenModeSelector';
import { MyAngleForm } from './MyAngleForm';
import { CloneAdForm } from './CloneAdForm';
import { FromExistingForm } from './FromExistingForm';
import { CreativeTypeSelector } from './CreativeTypeSelector';
import { GenerateButton } from './GenerateButton';
import { ProductPicker } from './ProductPicker';
import { ProductFoundationPanel } from './ProductFoundationPanel';
import { ProductImagePicker } from './ProductImagePicker';

export interface GeneratorFormProps {
  genConfig: GeneratorConfig;
  setGenConfig: SetGenConfig;
  generatorTab: UseGeneratorTabStateReturn;
  generatingPackage: boolean;
  genPackageError: string;
  clientHasCard: boolean | null;
  stores: Store[];
  storeFilter: string;
  products: Product[];
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  winners: any[];
  setupTemplates: any[];
  setShowTemplateSave: React.Dispatch<React.SetStateAction<boolean>>;
  onGeneratePackage: () => void;
  onGenerateMoreLikeThis: (winner: any) => void;
  onLoadFoundation: (productId: string) => void;
  onSaveFoundation: () => void;
  onApplyTemplate: (template: any) => void;
}

export function GeneratorForm({
  genConfig,
  setGenConfig,
  generatorTab,
  generatingPackage,
  genPackageError,
  clientHasCard,
  stores,
  storeFilter,
  products,
  setProducts,
  winners,
  setupTemplates,
  setShowTemplateSave,
  onGeneratePackage,
  onGenerateMoreLikeThis,
  onLoadFoundation,
  onSaveFoundation,
  onApplyTemplate,
}: GeneratorFormProps) {
  const {
    showAdvanced, setShowAdvanced,
    matchedWinnerRef, setMatchedWinnerRef,
    selectedExistingConcept, setSelectedExistingConcept,
    activeConceptAction, setActiveConceptAction,
    higgsStyle, setHiggsStyle,
    productSearch, setProductSearch,
    referenceVideoUrl, setReferenceVideoUrl,
    referenceVideoFile, setReferenceVideoFile,
    ingestMode, setIngestMode,
    cloneAdOutputMode, setCloneAdOutputMode,
    characterImageMode, setCharacterImageMode,
    characterImageFile, setCharacterImageFile,
    productFoundation, setProductFoundation,
    showFoundation, setShowFoundation,
    foundationSaving,
  } = generatorTab;

  return (
    <div className="space-y-4">

      {/* ── STEP 1: CONTENT TYPE + ENGINE ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        {/* Content Type selector */}
        <ContentTypeSelector contentType={genConfig.contentType} setGenConfig={setGenConfig} />

        {/* Dynamic Engine selector — shows only engines matching the selected content type */}
        <EngineSelector engine={genConfig.engine} contentType={genConfig.contentType} setGenConfig={setGenConfig} />
      </div>

      {/* ── HIGGSFIELD STYLE PRESETS — only when Higgsfield engine selected ── */}
      {genConfig.engine === 'higgsfield' && (
        <HiggsfieldStylePresets higgsStyle={higgsStyle} setHiggsStyle={setHiggsStyle} />
      )}

      {/* ── CONTENT MODE TOGGLE — service business mode flips concept-gen prompts ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={genConfig.contentMode === 'service'}
            onChange={(e) => setGenConfig(c => ({ ...c, contentMode: e.target.checked ? 'service' : 'product' }))}
            className="mt-0.5 w-4 h-4 accent-emerald-600"
          />
          <div className="flex-1">
            <div className="text-sm text-white font-medium">This is a service business</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Logos and service descriptions, no product image. Concept-gen prompts will use 3PL / service-business framing.</div>
          </div>
        </label>
      </div>

      {/* ── PATTERN 1: SHARED CHARACTER IMAGE — scene-based engines only ──
          Visible when the selected engine is sceneBased (seedance-scenes or
          animated). Two modes: auto-generate via Nano Banana before scene
          loop fires (default), or user-upload via /api/creatives/upload-
          character-image. The resulting URL is passed as
          uploadedCharacterImageUrl in the generate-package body and used as
          a shared reference across all scenes (R2V for seedance-scenes,
          storyboard-anchor for animated).
      */}
      {ENGINE_METADATA[genConfig.engine]?.sceneBased && genConfig.contentType === 'video' && (
        <div className="bg-slate-900 border border-pink-900/40 rounded-xl p-4 space-y-2">
          <label className="text-[10px] text-pink-400 uppercase font-bold block">Character Image (shared across scenes)</label>
          <p className="text-[9px] text-slate-400">
            Used as reference for visual continuity across all scenes. Default auto-generates one before the scene loop; upload to override.
          </p>
          <div className="flex gap-1 bg-slate-900/60 rounded-lg p-1">
            <button
              type="button"
              onClick={() => { setCharacterImageMode('auto'); setCharacterImageFile(null); }}
              className={`flex-1 px-3 py-1.5 rounded text-[10px] font-semibold transition-colors ${
                characterImageMode === 'auto' ? 'bg-pink-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Auto-generate (recommended)
            </button>
            <button
              type="button"
              onClick={() => setCharacterImageMode('upload')}
              className={`flex-1 px-3 py-1.5 rounded text-[10px] font-semibold transition-colors ${
                characterImageMode === 'upload' ? 'bg-pink-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Upload your own
            </button>
          </div>
          {characterImageMode === 'upload' && (
            <>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={e => setCharacterImageFile(e.target.files?.[0] ?? null)}
                className="w-full text-[10px] text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-pink-600 file:text-white file:font-semibold file:cursor-pointer file:text-[10px] hover:file:bg-pink-700"
              />
              {characterImageFile && (
                <p className="text-[9px] text-emerald-400">
                  Selected: {characterImageFile.name} ({(characterImageFile.size / 1_000_000).toFixed(1)} MB)
                </p>
              )}
              <p className="text-[9px] text-pink-400/60">
                JPEG/PNG/WebP, ≤10MB. Best results: vertical 9:16, clear face/upper body, neutral background.
              </p>
            </>
          )}
        </div>
      )}

      {/* ── SCENE-BASED ENGINE CONTROLS — animation style (animated only) + scene count slider ── */}
      {/* Gate is schema-driven: ENGINE_METADATA[engine].sceneBased flags both 'animated' and 'seedance-scenes'. */}
      {ENGINE_METADATA[genConfig.engine]?.sceneBased && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          {/* Animation style is animated-only — live-action UGC has no equivalent style picker. */}
          {genConfig.engine === 'animated' && (
            <AnimatedStyleSelector
              value={genConfig.animationStyle}
              onChange={(style) => setGenConfig(c => ({ ...c, animationStyle: style }))}
            />
          )}
          <div>
            <label className="text-[10px] text-slate-500 uppercase font-semibold mb-2 block">
              Storyboard Scenes ({genConfig.storyboardSceneCount || 4})
            </label>
            <input
              type="range"
              min={3}
              max={15}
              step={1}
              value={genConfig.storyboardSceneCount || 4}
              onChange={(e) => setGenConfig(c => ({ ...c, storyboardSceneCount: parseInt(e.target.value, 10) }))}
              className="w-full accent-purple-600"
            />
          </div>
          <div>
            <label className="text-[10px] text-slate-500 uppercase font-semibold mb-2 block">
              Video Length
            </label>
            <div className="text-sm text-slate-300">
              {genConfig.engine === 'animated'
                ? <>{(genConfig.storyboardSceneCount || 4) * 4} seconds ({genConfig.storyboardSceneCount || 4} scenes × 4s each)</>
                : <>{(genConfig.storyboardSceneCount || 4) * 5} seconds ({genConfig.storyboardSceneCount || 4} scenes × ~5s each, LLM-tuned within 4-15s)</>
              }
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 2: CONCEPT SOURCE ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <label className="text-[10px] text-purple-400 uppercase font-bold mb-2 block">2. Concept Source</label>
        <GenModeSelector genMode={genConfig.genMode} conceptAngle={genConfig.conceptAngle} setGenConfig={setGenConfig} />
        {/* Angle input — shows when My Angle is selected */}
        {genConfig.genMode === 'new' && genConfig.conceptAngle !== '' && (
          <MyAngleForm conceptAngle={genConfig.conceptAngle} setGenConfig={setGenConfig} />
        )}
        {genConfig.genMode === 'existing' && (
          <FromExistingForm winners={winners} selectedExistingConcept={selectedExistingConcept} setSelectedExistingConcept={setSelectedExistingConcept} handleGenerateMoreLikeThis={onGenerateMoreLikeThis} />
        )}
        {/* Clone Ad — reference video URL input */}
        {genConfig.genMode === 'clone_ad' && (
          <CloneAdForm
            referenceVideoUrl={referenceVideoUrl}
            setReferenceVideoUrl={setReferenceVideoUrl}
            referenceVideoFile={referenceVideoFile}
            setReferenceVideoFile={setReferenceVideoFile}
            ingestMode={ingestMode}
            setIngestMode={setIngestMode}
            cloneAdOutputMode={cloneAdOutputMode}
            setCloneAdOutputMode={setCloneAdOutputMode}
          />
        )}
      </div>

      {/* ── STEP 3: OUTPUT STRATEGY ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <OutputStrategySelector funnelStructure={genConfig.funnelStructure} setGenConfig={setGenConfig} />

        {/* Stage Focus — only for Single Stage */}
        {genConfig.funnelStructure !== 'full' && (
          <StageFocusSelector funnelStructure={genConfig.funnelStructure} setGenConfig={setGenConfig} />
        )}

        {/* Full Funnel helper */}
        {genConfig.funnelStructure === 'full' && (
          <div className="bg-blue-950/30 border border-blue-900/40 rounded-lg px-3 py-2">
            <p className="text-[10px] text-blue-400">Full Funnel Pack generates TOF + MOF + BOF for each concept.</p>
          </div>
        )}

        {/* Content Mix — only shown for Video content type (Image content type = always images) */}
        {genConfig.contentType === 'video' && (
          <ContentMixSelector contentMix={genConfig.contentMix} setGenConfig={setGenConfig} />
        )}
      </div>

      {/* ── STEP 3: PRODUCT + CONCEPT ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <label className="text-[10px] text-purple-400 uppercase font-bold block">5. Product & Concept</label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <ProductPicker
              stores={stores}
              storeFilter={storeFilter}
              products={products}
              productSearch={productSearch}
              setProductSearch={setProductSearch}
              productId={genConfig.productId}
              setGenConfig={setGenConfig}
              onLoadFoundation={onLoadFoundation}
            />
          </div>
        </div>
      </div>

      {/* ── CONCEPT SOURCE + VOLUME ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <ConceptSourceSelector conceptSource={genConfig.conceptSource} setGenConfig={setGenConfig} />

        {/* Volume — button selectors */}
        <div className="grid grid-cols-2 gap-3">
          <ConceptsCount quantity={genConfig.quantity} setGenConfig={setGenConfig} />
          <VariationsCount creativesPerConcept={genConfig.creativesPerConcept} setGenConfig={setGenConfig} />
        </div>

        {/* Output total */}
        {(() => {
          const total = genConfig.quantity * genConfig.creativesPerConcept;
          return (
            <div className="bg-purple-950/20 border border-purple-900/30 rounded-lg px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-purple-400 font-semibold">{genConfig.quantity} concept{genConfig.quantity > 1 ? 's' : ''} × {genConfig.creativesPerConcept} variation{genConfig.creativesPerConcept > 1 ? 's' : ''}</span>
                <span className="text-white font-bold text-sm">{total} total</span>
              </div>
              <p className="text-[9px] text-slate-500 mt-1">Each concept will generate {genConfig.creativesPerConcept} variation{genConfig.creativesPerConcept > 1 ? 's' : ''}</p>
            </div>
          );
        })()}

        {/* Product image selector + add image */}
        <ProductImagePicker
          products={products}
          setProducts={setProducts}
          productId={genConfig.productId}
          coverImageUrl={genConfig.coverImageUrl}
          setGenConfig={setGenConfig}
        />

        {/* Concept / Angle — only show here if not already shown under Concept Source */}
        {genConfig.genMode !== 'new' && (
          <div>
            <label className="text-[9px] text-slate-500 uppercase mb-1 block">Concept / Angle</label>
            <textarea value={genConfig.conceptAngle} onChange={e => setGenConfig(c => ({ ...c, conceptAngle: e.target.value }))}
              placeholder='e.g. "Sleep angle — people who struggle falling asleep"'
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-600 resize-none h-14" />
          </div>
        )}

        {/* Product Foundation — beliefs, unique mechanism */}
        <ProductFoundationPanel
          productId={genConfig.productId}
          productFoundation={productFoundation}
          setProductFoundation={setProductFoundation}
          showFoundation={showFoundation}
          setShowFoundation={setShowFoundation}
          foundationSaving={foundationSaving}
          onSaveFoundation={onSaveFoundation}
        />
      </div>

      {/* ── ADVANCED (collapsed) ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <button onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-800/30 transition-colors">
          <span className="text-[10px] text-slate-500 uppercase font-bold">Advanced Options</span>
          <svg className={`w-4 h-4 text-slate-500 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
        </button>
        {showAdvanced && (
          <div className="px-4 pb-4 space-y-3 border-t border-slate-800">
            {/* Creative Type */}
            <CreativeTypeSelector creativeType={genConfig.creativeType} setGenConfig={setGenConfig} />
            {/* Hook Style + Avatar — Presenter hidden for animated (no human characters in 3D/explainer styles) */}
            <div className={`grid gap-3 ${genConfig.engine === 'animated' ? 'grid-cols-1' : 'grid-cols-2'}`}>
              <HookStyleSelector hookStyle={genConfig.hookStyle} setGenConfig={setGenConfig} />
              {genConfig.engine !== 'animated' && (
                <PresenterSelector avatarStyle={genConfig.avatarStyle} setGenConfig={setGenConfig} />
              )}
            </div>
            {/* Duration + Aspect + Platform + Offer.
                Duration hidden for scene-based engines (animated, seedance-scenes) —
                derived from sceneCount in the scene-based config block above
                (animated: sceneCount × 4s; seedance-scenes: sceneCount × 5s).
                Frontend's videoDuration is ignored server-side for these engines
                (generate/route.ts overrides; mirrors the animated pattern). */}
            <div className={`grid gap-3 ${ENGINE_METADATA[genConfig.engine]?.sceneBased ? 'grid-cols-1' : 'grid-cols-2'}`}>
              {!ENGINE_METADATA[genConfig.engine]?.sceneBased && (
                <VideoDurationSelector videoDuration={genConfig.videoDuration} setGenConfig={setGenConfig} />
              )}
              <AspectRatioSelector dimension={genConfig.dimension} setGenConfig={setGenConfig} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <PlatformSelector platformTarget={genConfig.platformTarget} setGenConfig={setGenConfig} />
              <OfferInput offer={genConfig.offer} setGenConfig={setGenConfig} />
            </div>
            {/* Templates */}
            <div className="flex gap-2 pt-2 border-t border-slate-800">
              {setupTemplates.length > 0 && setupTemplates.map(t => (
                <button key={t.id} onClick={() => onApplyTemplate(t)}
                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-400 text-[9px] rounded border border-slate-700 truncate max-w-[120px]">{t.name}</button>
              ))}
              <button onClick={() => setShowTemplateSave(true)}
                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-400 text-[9px] rounded border border-slate-700">Save Setup</button>
            </div>
          </div>
        )}
      </div>

      {/* ── WINNER REFERENCE ── */}
      {matchedWinnerRef && (
        <div className="px-4 py-2.5 bg-amber-900/20 border border-amber-800/50 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-amber-500 text-black font-bold">WINNER DNA</span>
            <span className="text-xs text-amber-400">Using: "{matchedWinnerRef.title}"</span>
          </div>
          <button onClick={() => setMatchedWinnerRef(null)} className="text-[10px] text-slate-500 hover:text-white">Clear</button>
        </div>
      )}

      {activeConceptAction && (
        <div className={`px-4 py-2.5 rounded-xl flex items-center justify-between ${
          activeConceptAction === 'scale' ? 'bg-emerald-900/20 border border-emerald-800/50' :
          activeConceptAction === 'refresh' ? 'bg-amber-900/20 border border-amber-800/50' :
          'bg-blue-900/20 border border-blue-800/50'
        }`}>
          <div className="flex items-center gap-2">
            <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${
              activeConceptAction === 'scale' ? 'bg-emerald-500 text-black' :
              activeConceptAction === 'refresh' ? 'bg-amber-500 text-black' :
              'bg-blue-500 text-black'
            }`}>{activeConceptAction.toUpperCase().replace('_', ' ')}</span>
            <span className="text-xs text-slate-300">Concept: "{genConfig.conceptAngle}"</span>
          </div>
          <button onClick={() => { setActiveConceptAction(''); setGenConfig(c => ({ ...c, conceptAngle: '' })); }} className="text-[10px] text-slate-500 hover:text-white">Clear</button>
        </div>
      )}

      {/* ── GENERATE BUTTON ── */}
      {genPackageError && (
        <div className="px-3 py-2 bg-red-900/20 border border-red-800 rounded-lg text-xs text-red-400">{genPackageError}</div>
      )}
      {clientHasCard === false ? (
        <div className="bg-amber-900/20 border border-amber-800 rounded-xl p-4 text-center">
          <p className="text-amber-400 font-semibold text-sm mb-1">Payment method required</p>
          <p className="text-[11px] text-slate-400 mb-3">Add a card in the Billing tab before generating creatives. You will be charged based on usage — automatic billing at $20.</p>
          <button onClick={() => { const el = document.querySelector('[data-tab="billing"]') as HTMLElement; if (el) el.click(); }}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-lg">Go to Billing</button>
        </div>
      ) : (
        <GenerateButton
          generatingPackage={generatingPackage}
          clientHasCard={clientHasCard}
          genMode={genConfig.genMode}
          quantity={genConfig.quantity}
          creativesPerConcept={genConfig.creativesPerConcept}
          onClick={onGeneratePackage}
        />
      )}
    </div>
  );
}
