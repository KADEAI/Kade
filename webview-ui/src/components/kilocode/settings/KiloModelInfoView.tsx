import { type ModelInfo, type ProviderSettings } from "@roo-code/types";
import { useAppTranslation } from "@src/i18n/TranslationContext";
import { ModelDescriptionMarkdown } from "../../settings/ModelDescriptionMarkdown";
import { ModelInfoSupportsItem } from "@/components/settings/ModelInfoView";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  StandardTooltip,
} from "@/components/ui";
import { useQuery } from "@tanstack/react-query";
import { getKiloUrlFromToken } from "@roo-code/types";
import { telemetryClient } from "@/utils/TelemetryClient";
import { useModelProviders } from "@/components/ui/hooks/useSelectedModel";
import { z } from "zod";

const ModelStatsSchema = z.object({
  model: z.string(),
  cost: z.coerce.number(),
  costPerRequest: z.number(),
});

const ModelStatsResponseSchema = z.array(ModelStatsSchema);

type ModelStats = z.infer<typeof ModelStatsSchema>;

export const formatPrice = (
  price: number | Intl.StringNumericLiteral,
  digits: number = 2,
) => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(price);
};

const PricingTable = ({
  providers,
}: {
  providers: (ModelInfo & { label: string })[];
}) => {
  const { t } = useAppTranslation();
  const thClass =
    "text-left px-3 py-2 font-medium text-vscode-foreground whitespace-nowrap";
  const tdClass =
    "px-3 py-2 text-vscode-descriptionForeground whitespace-nowrap";
  return (
    <div className="overflow-x-auto border border-vscode-widget-border rounded-md">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-vscode-widget-border bg-vscode-editor-background">
            <th className={thClass}>
              {t("kilocode:settings.modelInfo.table.provider")}
            </th>
            <StandardTooltip
              content={t("kilocode:settings.modelInfo.table.context")}
            >
              <th className={thClass}>Context</th>
            </StandardTooltip>
            <StandardTooltip
              content={t("kilocode:settings.modelInfo.table.inputPrice")}
            >
              <th className={thClass}>Input</th>
            </StandardTooltip>
            <StandardTooltip
              content={t("kilocode:settings.modelInfo.table.outputPrice")}
            >
              <th className={thClass}>Output</th>
            </StandardTooltip>
            <StandardTooltip
              content={t("kilocode:settings.modelInfo.table.cacheReadPrice")}
            >
              <th className={thClass}>C Read</th>
            </StandardTooltip>
            <StandardTooltip
              content={t("kilocode:settings.modelInfo.table.cacheWritePrice")}
            >
              <th className={thClass}>C Write</th>
            </StandardTooltip>
          </tr>
        </thead>
        <tbody>
          {providers.map((item, index) => (
            <tr
              key={item.label}
              className={`border-b border-vscode-widget-border last:border-b-0 ${index % 2 === 0 ? "bg-vscode-editor-background" : "bg-vscode-sideBar-background"} hover:bg-vscode-list-hoverBackground`}
            >
              <td className="px-3 py-2 text-vscode-foreground whitespace-nowrap">
                {item.label}
              </td>
              <td className={tdClass}>{item.contextWindow.toLocaleString()}</td>
              <td className={tdClass}>{formatPrice(item.inputPrice ?? 0)}</td>
              <td className={tdClass}>{formatPrice(item.outputPrice ?? 0)}</td>
              <td className={tdClass}>
                {item.cacheReadsPrice && formatPrice(item.cacheReadsPrice)}
              </td>
              <td className={tdClass}>
                {item.cacheWritesPrice && formatPrice(item.cacheWritesPrice)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const KiloModelInfoView = ({
  apiConfiguration,
  modelId,
  model,
  isDescriptionExpanded,
  setIsDescriptionExpanded,
  isPricingExpanded,
  setIsPricingExpanded,
  hidePricing,
}: {
  apiConfiguration: ProviderSettings;
  modelId: string;
  model: ModelInfo;
  isDescriptionExpanded: boolean;
  setIsDescriptionExpanded: (isExpanded: boolean) => void;
  isPricingExpanded: boolean;
  setIsPricingExpanded: (isPricingExpanded: boolean) => void;
  hidePricing?: boolean;
}) => {
  const { t } = useAppTranslation();
  const providers = Object.values(
    useModelProviders(modelId, apiConfiguration).data ?? {},
  );
  const { data: modelStats } = useQuery<ModelStats[]>({
    queryKey: ["modelstats"],
    queryFn: async () => {
      try {
        const url = getKiloUrlFromToken(
          "https://api.kilo.ai/api/modelstats",
          apiConfiguration.kilocodeToken ?? "",
        );
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`Failed to fetch model stats: ${response.status}`);
        }

        const data = await response.json();

        return ModelStatsResponseSchema.parse(data);
      } catch (err) {
        if (err instanceof Error) {
          telemetryClient.captureException(err, { context: "modelstats" });
        }
        throw err;
      }
    },
  });
  const stats = modelStats?.find((ms) => ms.model === modelId);

  return (
    <div className="flex flex-col gap-3">
      {model.description && (
        <ModelDescriptionMarkdown
          key="description"
          markdown={model.description}
          isExpanded={isDescriptionExpanded}
          setIsExpanded={setIsDescriptionExpanded}
        />
      )}

      <div className="flex flex-col gap-2">
        {/* Capabilities & Limits */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-vscode-foreground">
          {model.contextWindow > 0 && (
            <div className="flex items-center gap-1">
              <span className="font-medium text-vscode-descriptionForeground">
                {t("kilocode:settings.modelInfo.contextWindow")}:
              </span>
              <span>{model.contextWindow.toLocaleString()}</span>
            </div>
          )}
          {typeof model.maxTokens === "number" && model.maxTokens > 0 && (
            <div className="flex items-center gap-1">
              <span className="font-medium text-vscode-descriptionForeground">
                {t("settings:modelInfo.maxOutput")}:
              </span>
              <span>{model.maxTokens.toLocaleString()}</span>
            </div>
          )}
          <ModelInfoSupportsItem
            isSupported={model.supportsImages ?? false}
            supportsLabel={t("settings:modelInfo.supportsImages")}
            doesNotSupportLabel={t("settings:modelInfo.noImages")}
          />
          <ModelInfoSupportsItem
            isSupported={model.supportsPromptCache}
            supportsLabel={t("settings:modelInfo.supportsPromptCache")}
            doesNotSupportLabel={t("settings:modelInfo.noPromptCache")}
          />
        </div>

        {/* Average KiloCode Cost Pills */}
        {!hidePricing &&
          stats &&
          stats.cost &&
          stats.costPerRequest &&
          model.inputPrice &&
          model.outputPrice && (
            <StandardTooltip
              content={t("kilocode:settings.modelInfo.averageKiloCodeCost")}
            >
              <div className="flex flex-wrap gap-2 mt-1">
                <CostPill label="Avg Cost" price={formatPrice(stats.cost)} />
                <CostPill
                  label="Avg Request"
                  price={formatPrice(stats.costPerRequest, 4)}
                  unit="/ request"
                />
              </div>
            </StandardTooltip>
          )}
      </div>

      {!hidePricing && (
        <Collapsible
          open={isPricingExpanded}
          onOpenChange={setIsPricingExpanded}
        >
          <CollapsibleTrigger className="flex items-center gap-1 w-full cursor-pointer hover:opacity-80 mt-1">
            <span
              className={`codicon codicon-chevron-${isPricingExpanded ? "down" : "right"}`}
            ></span>
            <span className="font-medium text-xs">
              {t("kilocode:settings.modelInfo.providerBreakdown")}
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <PricingTable providers={providers} />
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
};

const CostPill = ({
  label,
  price,
  unit = "/ M",
}: {
  label: string;
  price: string;
  unit?: string;
}) => (
  <div className="relative overflow-hidden rounded-full bg-vscode-textBlockQuote-background border border-vscode-textBlockQuote-border px-3 py-1 flex items-center gap-2 group cursor-default shadow-sm">
    {/* Animated sheen effect */}
    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-vscode-editor-foreground/10 to-transparent translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-1000 ease-in-out" />

    <span className="text-[10px] uppercase font-semibold text-vscode-descriptionForeground tracking-wider">
      {label}
    </span>
    <div className="w-px h-3 bg-vscode-textBlockQuote-border/50" />
    <span className="text-xs font-medium text-vscode-foreground font-mono">
      {price}{" "}
      <span className="text-[10px] text-vscode-descriptionForeground font-sans normal-case">
        {unit}
      </span>
    </span>
  </div>
);
