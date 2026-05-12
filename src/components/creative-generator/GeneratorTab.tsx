'use client';

import type { Ad, CreativePackage, CreativesTab, GeneratorConfig, Product, Store } from '@/components/creative-generator/types';
import type { SetGenConfig } from './hooks/useGeneratorState';
import type { UseGeneratorTabStateReturn } from './hooks/useGeneratorTabState';
import type { UsePackageGenerationStateReturn } from './hooks/usePackageGenerationState';
import type { UsePerPackageRenderStateReturn } from './hooks/usePerPackageRenderState';
import type { UseMetaLaunchStateReturn } from './hooks/useMetaLaunchState';
import type { UseAccountIntelligenceStateReturn } from './hooks/useAccountIntelligenceState';
import type { UseGenerationHistoryStateReturn } from './hooks/useGenerationHistoryState';
import type { UseWinnerTemplateModalStateReturn } from './hooks/useWinnerTemplateModalState';
import { GeneratorForm } from './GeneratorForm';
import { GeneratorOutputArea } from './GeneratorOutputArea';
import { RecentlyTestedConceptsPanel } from './RecentlyTestedConceptsPanel';
import { WinningConceptsPanel } from './WinningConceptsPanel';
import { CreativeFatigueMonitor } from './CreativeFatigueMonitor';
import { RecommendationsPanel } from './RecommendationsPanel';
import { TopHooksByCTRPanel } from './TopHooksByCTRPanel';
import { TopCreativesByROASPanel } from './TopCreativesByROASPanel';
import { MostEfficientByCPAPanel } from './MostEfficientByCPAPanel';
import { TopConvertersByCVRPanel } from './TopConvertersByCVRPanel';
import { TrendsPanel } from './TrendsPanel';
import { ConceptScorecardsPanel } from './ConceptScorecardsPanel';
import { ProductPerformancePanel } from './ProductPerformancePanel';
import { LearnedPatternsPanel } from './LearnedPatternsPanel';
import { StrategyDisplay } from './StrategyDisplay';
import { GenerationHistoryPanel } from './GenerationHistoryPanel';
import { WinningAdsForBaseSelection } from './WinningAdsForBaseSelection';

export interface GeneratorTabProps {
  tab: CreativesTab;
  storeFilter: string;
  genConfig: GeneratorConfig;
  setGenConfig: SetGenConfig;
  generatorTab: UseGeneratorTabStateReturn;
  packageGeneration: UsePackageGenerationStateReturn;
  perPackageRender: UsePerPackageRenderStateReturn;
  metaLaunch: UseMetaLaunchStateReturn;
  accountIntelligence: UseAccountIntelligenceStateReturn;
  generationHistory: UseGenerationHistoryStateReturn;
  winnerTemplateModal: UseWinnerTemplateModalStateReturn;
  stores: Store[];
  products: Product[];
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  winners: any[];
  setupTemplates: any[];
  onGeneratePackage: () => void;
  onGenerateMoreLikeThis: (winner: any) => void;
  onConceptAction: (concept: any, action: string) => void;
  onApplyTemplate: (template: any) => void;
  onLoadFoundation: (productId: string) => void;
  onSaveFoundation: () => void;
  onLoadHistoryItem: (id: string) => void;
  onRenderImage: (pkg: CreativePackage, idx: number, engine?: string) => void;
  onRetryRender: (pkg: CreativePackage, idx: number) => void;
  onGenerateVideoFromPackage: (pkg: CreativePackage, idx: number, engine?: string) => void;
  onGenerateVariations: (idx: number) => void;
  onGenerateAll: (mode: 'all' | 'sequential') => void;
  onToggleCompare: (idx: number) => void;
  onLaunchToMeta: () => void;
}

export function GeneratorTab({
  tab,
  storeFilter,
  genConfig,
  setGenConfig,
  generatorTab,
  packageGeneration,
  perPackageRender,
  metaLaunch,
  accountIntelligence,
  generationHistory,
  winnerTemplateModal,
  stores,
  products,
  setProducts,
  winners,
  setupTemplates,
  onGeneratePackage,
  onGenerateMoreLikeThis,
  onConceptAction,
  onApplyTemplate,
  onLoadFoundation,
  onSaveFoundation,
  onLoadHistoryItem,
  onRenderImage,
  onRetryRender,
  onGenerateVideoFromPackage,
  onGenerateVariations,
  onGenerateAll,
  onToggleCompare,
  onLaunchToMeta,
}: GeneratorTabProps) {
  if (tab !== 'generator') return null;

  const { generatingPackage, genPackages, genPackageError, genStrategy } = packageGeneration;
  const { accountIntel, conceptData, clientHasCard } = accountIntelligence;
  const { genHistory, genHistoryLoading, viewingHistory } = generationHistory;
  const { matchedWinnerRef } = generatorTab;
  const { setShowTemplateSave, setShowWinnerModal } = winnerTemplateModal;

  // Inlined from page.tsx — closure over genConfig.engine (parity with bestEngineForDuration helper)
  const defaultVideoEngine = (() => {
    const duration = genConfig.videoDuration || 20;
    if (genConfig.engine && genConfig.engine !== 'auto') return genConfig.engine;
    if (duration <= 8) return 'veo';
    if (duration <= 10) return 'seedance';   // Seedance: 5-10s native
    return 'sora';
  })();

  return (
    <>
      {!storeFilter ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <p className="text-slate-400">Select a store to use the Creative Generator</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT: Generator Form */}
          <div className="lg:col-span-2 space-y-5">
            {/* ═══ CLEAN GENERATOR FORM ═══ */}
            <GeneratorForm
              genConfig={genConfig}
              setGenConfig={setGenConfig}
              generatorTab={generatorTab}
              generatingPackage={generatingPackage}
              genPackageError={genPackageError}
              clientHasCard={clientHasCard}
              stores={stores}
              storeFilter={storeFilter}
              products={products}
              setProducts={setProducts}
              winners={winners}
              setupTemplates={setupTemplates}
              setShowTemplateSave={setShowTemplateSave}
              onGeneratePackage={onGeneratePackage}
              onGenerateMoreLikeThis={onGenerateMoreLikeThis}
              onLoadFoundation={onLoadFoundation}
              onSaveFoundation={onSaveFoundation}
              onApplyTemplate={onApplyTemplate}
            />

            {/* ═══ Generated Output Area ═══ */}
            <GeneratorOutputArea
              packageGeneration={packageGeneration}
              perPackageRender={perPackageRender}
              metaLaunch={metaLaunch}
              genConfig={genConfig}
              matchedWinnerRef={matchedWinnerRef}
              defaultVideoEngine={defaultVideoEngine}
              onRenderImage={onRenderImage}
              onRetryRender={onRetryRender}
              onGenerateVideoFromPackage={onGenerateVideoFromPackage}
              onGenerateVariations={onGenerateVariations}
              onGenerateAll={onGenerateAll}
              onToggleCompare={onToggleCompare}
              onLaunchToMeta={onLaunchToMeta}
              onShowWinnerModal={setShowWinnerModal}
            />
          </div>

          {/* RIGHT: Strategy Intelligence Panel */}
          <div className="space-y-4">
            {/* Recently Tested Concepts */}
            <RecentlyTestedConceptsPanel genPackages={genPackages} setGenConfig={setGenConfig} />
            {/* Winning Concepts */}
            <WinningConceptsPanel conceptData={conceptData} setGenConfig={setGenConfig} />

            {/* Creative Fatigue Monitor */}
            <CreativeFatigueMonitor conceptData={conceptData} />

            {/* Recommendations */}
            <RecommendationsPanel accountIntel={accountIntel} setGenConfig={setGenConfig} />

            {/* Top Hooks by CTR */}
            <TopHooksByCTRPanel accountIntel={accountIntel} />

            {/* Top Creatives by ROAS */}
            <TopCreativesByROASPanel accountIntel={accountIntel} />

            {/* Most Efficient by CPA */}
            <MostEfficientByCPAPanel accountIntel={accountIntel} />

            {/* Top Converters by CVR */}
            <TopConvertersByCVRPanel accountIntel={accountIntel} />

            {/* Trends: Rising / Declining / Fatigue / Scaling */}
            <TrendsPanel accountIntel={accountIntel} />

            {/* Concept Scorecards */}
            <ConceptScorecardsPanel accountIntel={accountIntel} onConceptAction={onConceptAction} />

            {/* Product Performance */}
            <ProductPerformancePanel accountIntel={accountIntel} />

            {/* Learned Patterns — Feedback Loop */}
            <LearnedPatternsPanel accountIntel={accountIntel} />

            {/* Strategy Object — shown after generation */}
            <StrategyDisplay genStrategy={genStrategy} viewingHistory={viewingHistory} />

            {/* Generation History */}
            <GenerationHistoryPanel
              genHistory={genHistory}
              genHistoryLoading={genHistoryLoading}
              viewingHistory={viewingHistory}
              onLoadHistoryItem={onLoadHistoryItem}
            />

            {/* Winning Ads for Base Selection */}
            <WinningAdsForBaseSelection
              generationGoal={genConfig.generationGoal}
              baseAdId={genConfig.baseAdId}
              accountIntel={accountIntel}
              setGenConfig={setGenConfig}
            />
          </div>
        </div>
      )}
    </>
  );
}
