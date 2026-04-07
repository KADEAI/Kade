import { VSCodeLink } from "@vscode/webview-ui-toolkit/react";

import type { ModelInfo } from "@roo-code/types";

import { formatPrice } from "@src/utils/formatPrice";
import { cn } from "@src/lib/utils";
import { useAppTranslation } from "@src/i18n/TranslationContext";

import { ModelDescriptionMarkdown } from "./ModelDescriptionMarkdown";

type ModelInfoViewProps = {
  apiProvider?: string;
  selectedModelId: string;
  modelInfo?: ModelInfo;
  isDescriptionExpanded: boolean;
  setIsDescriptionExpanded: (isExpanded: boolean) => void;
  hidePricing?: boolean;
};

export const ModelInfoView = ({
  apiProvider,
  selectedModelId,
  modelInfo,
  isDescriptionExpanded,
  setIsDescriptionExpanded,
  hidePricing,
}: ModelInfoViewProps) => {
  const { t } = useAppTranslation();

  // Show tiered pricing table for OpenAI Native when model supports non-standard tiers
  const allowedTierNames =
    modelInfo?.tiers
      ?.filter((t) => t.name === "flex" || t.name === "priority")
      ?.map((t) => t.name) ?? [];
  const shouldShowTierPricingTable =
    apiProvider === "openai-native" && allowedTierNames.length > 0;
  const fmt = (n?: number) =>
    typeof n === "number" ? `${formatPrice(n)}` : "—";

  return (
    <div className="flex flex-col gap-3">
      {modelInfo?.description && (
        <ModelDescriptionMarkdown
          key="description"
          markdown={modelInfo.description}
          isExpanded={isDescriptionExpanded}
          setIsExpanded={setIsDescriptionExpanded}
        />
      )}

      <div className="flex flex-col gap-2">
        {/* Capabilities & Limits */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-vscode-foreground">
          {typeof modelInfo?.contextWindow === "number" &&
            modelInfo.contextWindow > 0 && (
              <div className="flex items-center gap-1">
                <span className="font-medium text-vscode-descriptionForeground">
                  {t("settings:modelInfo.contextWindow")}
                </span>
                <span>{modelInfo.contextWindow.toLocaleString()}</span>
              </div>
            )}
          {typeof modelInfo?.maxTokens === "number" &&
            modelInfo.maxTokens > 0 && (
              <div className="flex items-center gap-1">
                <span className="font-medium text-vscode-descriptionForeground">
                  {t("settings:modelInfo.maxOutput")}:
                </span>
                <span>{modelInfo.maxTokens.toLocaleString()}</span>
              </div>
            )}
          <ModelInfoSupportsItem
            isSupported={modelInfo?.supportsImages ?? false}
            supportsLabel={t("settings:modelInfo.supportsImages")}
            doesNotSupportLabel={t("settings:modelInfo.noImages")}
          />
          <ModelInfoSupportsItem
            isSupported={modelInfo?.supportsPromptCache ?? false}
            supportsLabel={t("settings:modelInfo.supportsPromptCache")}
            doesNotSupportLabel={t("settings:modelInfo.noPromptCache")}
          />
        </div>

        {/* Gemini Note */}
        {apiProvider === "gemini" && (
          <div className="text-xs italic text-vscode-descriptionForeground">
            {selectedModelId.includes("pro-preview")
              ? t("settings:modelInfo.gemini.billingEstimate")
              : t("settings:modelInfo.gemini.freeRequests", {
                  count:
                    selectedModelId && selectedModelId.includes("flash")
                      ? 15
                      : 2,
                })}{" "}
            <VSCodeLink
              href="https://ai.google.dev/pricing"
              className="text-xs"
            >
              {t("settings:modelInfo.gemini.pricingDetails")}
            </VSCodeLink>
          </div>
        )}

        {/* Cost Pills */}
        {!shouldShowTierPricingTable && !hidePricing && (
          <div className="flex flex-wrap gap-2 mt-1">
            {modelInfo?.inputPrice !== undefined && (
              <CostPill
                label={t("settings:modelInfo.inputPrice")}
                price={formatPrice(modelInfo.inputPrice)}
              />
            )}
            {modelInfo?.outputPrice !== undefined && (
              <CostPill
                label={t("settings:modelInfo.outputPrice")}
                price={formatPrice(modelInfo.outputPrice)}
              />
            )}
            {modelInfo?.supportsPromptCache && modelInfo.cacheReadsPrice && (
              <CostPill
                label={t("settings:modelInfo.cacheReadsPrice")}
                price={formatPrice(modelInfo.cacheReadsPrice)}
              />
            )}
            {modelInfo?.supportsPromptCache && modelInfo.cacheWritesPrice && (
              <CostPill
                label={t("settings:modelInfo.cacheWritesPrice")}
                price={formatPrice(modelInfo.cacheWritesPrice)}
              />
            )}
          </div>
        )}
      </div>

      {shouldShowTierPricingTable && !hidePricing && (
        <div className="mt-1">
          <div className="text-xs text-vscode-descriptionForeground mb-1">
            {t("settings:serviceTier.pricingTableTitle")}
          </div>
          <div className="border border-vscode-dropdown-border rounded-sm overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-vscode-dropdown-background">
                <tr>
                  <th className="text-left px-3 py-1.5 font-medium">
                    {t("settings:serviceTier.columns.tier")}
                  </th>
                  <th className="text-right px-3 py-1.5 font-medium">
                    {t("settings:serviceTier.columns.input")}
                  </th>
                  <th className="text-right px-3 py-1.5 font-medium">
                    {t("settings:serviceTier.columns.output")}
                  </th>
                  <th className="text-right px-3 py-1.5 font-medium">
                    {t("settings:serviceTier.columns.cacheReads")}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-vscode-dropdown-border/60">
                  <td className="px-3 py-1.5">
                    {t("settings:serviceTier.standard")}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {fmt(modelInfo?.inputPrice)}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {fmt(modelInfo?.outputPrice)}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {fmt(modelInfo?.cacheReadsPrice)}
                  </td>
                </tr>
                {allowedTierNames.includes("flex") && (
                  <tr className="border-t border-vscode-dropdown-border/60">
                    <td className="px-3 py-1.5">
                      {t("settings:serviceTier.flex")}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {fmt(
                        modelInfo?.tiers?.find((t) => t.name === "flex")
                          ?.inputPrice ?? modelInfo?.inputPrice,
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {fmt(
                        modelInfo?.tiers?.find((t) => t.name === "flex")
                          ?.outputPrice ?? modelInfo?.outputPrice,
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {fmt(
                        modelInfo?.tiers?.find((t) => t.name === "flex")
                          ?.cacheReadsPrice ?? modelInfo?.cacheReadsPrice,
                      )}
                    </td>
                  </tr>
                )}
                {allowedTierNames.includes("priority") && (
                  <tr className="border-t border-vscode-dropdown-border/60">
                    <td className="px-3 py-1.5">
                      {t("settings:serviceTier.priority")}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {fmt(
                        modelInfo?.tiers?.find((t) => t.name === "priority")
                          ?.inputPrice ?? modelInfo?.inputPrice,
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {fmt(
                        modelInfo?.tiers?.find((t) => t.name === "priority")
                          ?.outputPrice ?? modelInfo?.outputPrice,
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {fmt(
                        modelInfo?.tiers?.find((t) => t.name === "priority")
                          ?.cacheReadsPrice ?? modelInfo?.cacheReadsPrice,
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

const CostPill = ({ label, price }: { label: string; price: string }) => (
  <div className="relative overflow-hidden rounded-full bg-vscode-textBlockQuote-background border border-vscode-textBlockQuote-border px-3 py-1 flex items-center gap-2 group cursor-default">
    {/* Animated sheen effect */}
    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-vscode-editor-foreground/10 to-transparent translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-1000 ease-in-out" />

    <span className="text-[10px] uppercase font-semibold text-vscode-descriptionForeground tracking-wider">
      {label.replace("Price", "")}
    </span>
    <div className="w-px h-3 bg-vscode-textBlockQuote-border/50" />
    <span className="text-xs font-medium text-vscode-foreground font-mono">
      {price}{" "}
      <span className="text-[10px] text-vscode-descriptionForeground font-sans normal-case">
        / M
      </span>
    </span>
  </div>
);

export /*kade_change*/ const ModelInfoSupportsItem = ({
  isSupported,
  supportsLabel,
  doesNotSupportLabel,
}: {
  isSupported: boolean;
  supportsLabel: string;
  doesNotSupportLabel: string;
}) => (
  <div className="flex items-center gap-1.5 text-xs text-vscode-descriptionForeground">
    <span
      className={cn(
        "codicon text-[14px]",
        isSupported
          ? "codicon-check text-vscode-testing-iconPassed"
          : "codicon-x text-vscode-testing-iconFailed",
      )}
    />
    <span>{isSupported ? supportsLabel : doesNotSupportLabel}</span>
  </div>
);
