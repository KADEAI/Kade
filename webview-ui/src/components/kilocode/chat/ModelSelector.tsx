import { useEffect, useMemo, useState } from "react";
import { SelectDropdown, DropdownOptionType, StandardTooltip } from "@/components/ui";
import {
  OPENROUTER_DEFAULT_PROVIDER_NAME,
  type ModelInfo,
  type ProviderSettings,
} from "@roo-code/types";
import { vscode } from "@src/utils/vscode";
import { cn } from "@src/lib/utils";
import { prettyModelName } from "../../../utils/prettyModelName";
import { useProviderModels } from "../hooks/useProviderModels";
import { getModelIdKey, getSelectedModelId } from "../hooks/useSelectedModel";
import { usePreferredModels } from "@/components/ui/hooks/kilocode/usePreferredModels";
import { getProviderIcon } from "../../settings/providerIcons";
import { ArrowDown, ArrowUp, Check, type LucideIcon } from "lucide-react";
import { useKiloCreditBalance } from "@/components/ui/hooks/useKiloCreditBalance";

type ModelSortMode =
  | "alphabetical-asc"
  | "alphabetical-desc"
  | "price-low"
  | "price-high";

const MODEL_SORT_MODE_ORDER: ModelSortMode[] = [
  "alphabetical-asc",
  "alphabetical-desc",
  "price-low",
  "price-high",
];
const MODEL_SORT_STORAGE_KEY = "kilocode:model-selector-sort-mode";

const MODEL_SORT_MODE_META: Record<
  ModelSortMode,
  {
    tooltip: string;
    glyph: string;
    className: string;
    arrow: LucideIcon;
  }
> = {
  "alphabetical-asc": {
    tooltip: "Sort models alphabetically from A to Z",
    glyph: "A",
    className: "text-sky-100/70",
    arrow: ArrowDown,
  },
  "alphabetical-desc": {
    tooltip: "Sort models alphabetically from Z to A",
    glyph: "Z",
    className: "text-slate-100/70",
    arrow: ArrowUp,
  },
  "price-low": {
    tooltip: "Sort models by lowest total price",
    glyph: "$",
    className: "text-emerald-200/70",
    arrow: ArrowDown,
  },
  "price-high": {
    tooltip: "Sort models by highest total price",
    glyph: "$$",
    className: "text-amber-100/70",
    arrow: ArrowUp,
  },
};

const getInitialSortMode = (): ModelSortMode => {
  if (typeof window === "undefined") {
    return "alphabetical-asc";
  }

  try {
    const storedValue = window.localStorage.getItem(MODEL_SORT_STORAGE_KEY);
    if (
      storedValue &&
      MODEL_SORT_MODE_ORDER.includes(storedValue as ModelSortMode)
    ) {
      return storedValue as ModelSortMode;
    }
  } catch {
    // Ignore localStorage access issues and fall back to the default mode.
  }

  return "alphabetical-asc";
};

const formatModelPrice = (price?: number) => {
  if (typeof price !== "number" || Number.isNaN(price)) {
    return undefined;
  }

  const maximumFractionDigits =
    price < 0.01 ? 6 : price < 1 ? 4 : price < 10 ? 3 : 2;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits,
  }).format(price);
};

const stripLeadingCurrencySymbol = (value: string) => value.replace(/^\$/, "");

const hasNegativePrice = (model?: ModelInfo) =>
  (typeof model?.inputPrice === "number" && model.inputPrice < 0) ||
  (typeof model?.outputPrice === "number" && model.outputPrice < 0);

const getCompactPricingDisplay = (model?: ModelInfo) => {
  if (isZeroCostModel(model) || hasNegativePrice(model)) {
    return undefined;
  }

  const inputPrice = formatModelPrice(model?.inputPrice);
  const outputPrice = formatModelPrice(model?.outputPrice);

  if (!inputPrice && !outputPrice) {
    return undefined;
  }

  if (inputPrice && outputPrice) {
    return `${inputPrice}|${stripLeadingCurrencySymbol(outputPrice)}`;
  }

  return inputPrice ?? outputPrice;
};

const isZeroCostModel = (model?: ModelInfo) => {
  const hasInputPrice = typeof model?.inputPrice === "number";
  const hasOutputPrice = typeof model?.outputPrice === "number";

  if (!hasInputPrice && !hasOutputPrice) {
    return false;
  }

  return (model?.inputPrice ?? 0) === 0 && (model?.outputPrice ?? 0) === 0;
};

const getModelTotalPrice = (model?: ModelInfo) => {
  const hasInputPrice = typeof model?.inputPrice === "number";
  const hasOutputPrice = typeof model?.outputPrice === "number";

  if (!hasInputPrice && !hasOutputPrice) {
    return null;
  }

  if (hasNegativePrice(model)) {
    return 0;
  }

  return (model?.inputPrice ?? 0) + (model?.outputPrice ?? 0);
};

const getModelSelectorLabel = ({
  provider,
  modelId,
  modelInfo,
}: {
  provider: ProviderSettings["apiProvider"];
  modelId: string;
  modelInfo?: ModelInfo;
}) => {
  const rawLabel = modelInfo?.displayName ?? prettyModelName(modelId);
  const colonStrippedLabel = rawLabel.includes(":")
    ? rawLabel.split(":").slice(1).join(":").trim()
    : rawLabel;

  if (provider === "baseten" && colonStrippedLabel.includes(" / ")) {
    return colonStrippedLabel.split(" / ").slice(1).join(" / ").trim();
  }

  return colonStrippedLabel;
};

const formatCreditsBalance = (value?: number | null) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return undefined;
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.max(0, value));
};

interface ModelSelectorProps {
  currentApiConfigName?: string;
  apiConfiguration: ProviderSettings;
  fallbackText: string;
  virtualQuotaActiveModel?: { id: string; name: string }; // kade_change: Add virtual quota active model for UI display
  scope?: "task" | "global"; // kade_change: Scope for settings updates
  hideLabel?: boolean;
}

export const ModelSelector = ({
  currentApiConfigName,
  apiConfiguration,
  fallbackText,
  virtualQuotaActiveModel, //kade_change
  scope, // kade_change
  hideLabel = false,
}: ModelSelectorProps) => {
  const { provider, providerModels, providerDefaultModel, isLoading, isError } =
    useProviderModels(apiConfiguration);
  const [sortMode, setSortMode] = useState<ModelSortMode>(getInitialSortMode);
  const selectedModelId = getSelectedModelId({
    provider,
    apiConfiguration,
    defaultModelId: providerDefaultModel,
  });
  const modelIdKey = getModelIdKey({ provider });
  const isAutocomplete = apiConfiguration.profileType === "autocomplete";
  const sortGlyph = MODEL_SORT_MODE_META[sortMode].glyph;
  const sortModeClassName = MODEL_SORT_MODE_META[sortMode].className;
  const SortArrow = MODEL_SORT_MODE_META[sortMode].arrow;
  const { data: kiloCreditsBalance, isLoading: isLoadingKiloCredits } =
    useKiloCreditBalance(provider === "kilocode" && !!apiConfiguration?.kilocodeToken);
  const creditsDisplay =
    provider === "kilocode" ? formatCreditsBalance(kiloCreditsBalance) : undefined;
  const isLoadingCredits = provider === "kilocode" ? isLoadingKiloCredits : false;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(MODEL_SORT_STORAGE_KEY, sortMode);
    } catch {
      // Ignore persistence failures; the UI still works without localStorage.
    }
  }, [sortMode]);

  const preferredModelsIds = usePreferredModels(providerModels);
  const modelsIds = useMemo(() => {
    const sortableModelIds = preferredModelsIds.filter(
      (modelId) => modelId !== selectedModelId,
    );

    const collator = new Intl.Collator(undefined, {
      sensitivity: "base",
      numeric: true,
    });

    const getLabel = (modelId: string) =>
      getModelSelectorLabel({
        provider,
        modelId,
        modelInfo: providerModels[modelId],
      });

    const sortedModelIds = [...sortableModelIds].sort((modelIdA, modelIdB) => {
      if (
        sortMode === "alphabetical-asc" ||
        sortMode === "alphabetical-desc"
      ) {
        const comparison = collator.compare(
          getLabel(modelIdA),
          getLabel(modelIdB),
        );
        return sortMode === "alphabetical-asc" ? comparison : -comparison;
      }

      const priceA = getModelTotalPrice(providerModels[modelIdA]);
      const priceB = getModelTotalPrice(providerModels[modelIdB]);

      if (priceA === null && priceB === null) {
        return collator.compare(getLabel(modelIdA), getLabel(modelIdB));
      }
      if (priceA === null) {
        return 1;
      }
      if (priceB === null) {
        return -1;
      }
      if (priceA !== priceB) {
        return sortMode === "price-low" ? priceA - priceB : priceB - priceA;
      }

      return collator.compare(getLabel(modelIdA), getLabel(modelIdB));
    });

    return [selectedModelId].concat(sortedModelIds);
  }, [preferredModelsIds, provider, providerModels, selectedModelId, sortMode]);

  const options = useMemo(() => {
    return modelsIds.map((modelId) => {
      const modelInfo = providerModels[modelId];
      const label = getModelSelectorLabel({
        provider,
        modelId,
        modelInfo,
      });

      const icon = getProviderIcon(modelId);

      return {
        value: modelId,
        label,
        type: DropdownOptionType.ITEM,
        icon,
        description: getCompactPricingDisplay(modelInfo),
      };
    });
  }, [modelsIds, provider, providerModels]);

  const disabled = isLoading || isError || isAutocomplete;

  const onChange = (value: string) => {
    if (!currentApiConfigName) {
      return;
    }
    if (apiConfiguration[modelIdKey] === value) {
      // don't reset openRouterSpecificProvider
      return;
    }
    vscode.postMessage({
      type: "upsertApiConfiguration",
      text: currentApiConfigName,
      apiConfiguration: {
        ...apiConfiguration,
        [modelIdKey]: value,
        openRouterSpecificProvider: OPENROUTER_DEFAULT_PROVIDER_NAME,
      },
      scope, // kade_change
    });
  };

  if (isLoading) {
    return null;
  }

  // kade_change start: Display active model for virtual quota fallback
  if (provider === "virtual-quota-fallback" && virtualQuotaActiveModel) {
    return (
      <span className="text-xs text-vscode-descriptionForeground opacity-70 truncate">
        {prettyModelName(virtualQuotaActiveModel.id)}
      </span>
    );
  }
  // kade_change end

  if (isError || isAutocomplete || options.length <= 0) {
    return (
      <span className="text-xs text-vscode-descriptionForeground opacity-70 truncate">
        {fallbackText}
      </span>
    );
  }

  return (
    <SelectDropdown
      value={selectedModelId}
      disabled={disabled}
      title={undefined}
      options={options}
      onChange={onChange}
      triggerClassName={cn(
        "text-ellipsis overflow-hidden",
        "bg-transparent border-none",
        "hover:bg-[rgba(255,255,255,0.03)]",
        "focus:outline-none focus:ring-0 focus:border-0 focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
        "active:bg-[rgba(255,255,255,0.1)]",
      )}
      triggerIcon={false}
      itemClassName="group"
      hideLabel={hideLabel}
      searchMeta={
        provider === "kilocode" ? (
          <span className="text-[10px] font-medium leading-none text-vscode-descriptionForeground/65 whitespace-nowrap">
            Credits: {creditsDisplay ?? (isLoadingCredits ? "..." : "--")}
          </span>
        ) : undefined
      }
      headerAction={
        <StandardTooltip
          content={`${MODEL_SORT_MODE_META[sortMode].tooltip}. Click to cycle.`}
        >
          <button
            type="button"
            data-testid="model-sort-button"
            aria-label={`Model sort mode: ${MODEL_SORT_MODE_META[sortMode].tooltip}`}
            onClick={(event) => {
              const dropdownContent = event.currentTarget.closest(
                '[data-select-dropdown-content="true"]',
              );
              const scrollArea = dropdownContent?.querySelector<HTMLElement>(
                '[data-select-dropdown-scroll-area="true"]',
              );

              if (scrollArea && typeof scrollArea.scrollTo === "function") {
                scrollArea.scrollTo({ top: 0, behavior: "smooth" });
              }

              setSortMode((currentMode) => {
                const currentIndex = MODEL_SORT_MODE_ORDER.indexOf(currentMode);
                const nextIndex =
                  (currentIndex + 1) % MODEL_SORT_MODE_ORDER.length;
                return MODEL_SORT_MODE_ORDER[nextIndex];
              });
            }}
            className={cn(
              "inline-flex h-7 min-w-7 items-center justify-center rounded-md bg-transparent p-0 transition-opacity duration-150 cursor-pointer",
              "hover:bg-transparent hover:opacity-100",
              "focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
              "active:scale-[0.98] opacity-80",
              sortModeClassName,
            )}
          >
            <span className="inline-flex items-center gap-[2px]">
              <span className="text-[11px] font-semibold leading-none tracking-tight">
                {sortGlyph}
              </span>
              <SortArrow className="size-[9px] opacity-80" strokeWidth={2.4} />
            </span>
          </button>
        </StandardTooltip>
      }
      renderItem={(option) => {
        const modelInfo = providerModels[option.value];
        const showZeroCostIndicator = isZeroCostModel(modelInfo);
        const hasVisiblePrice = !showZeroCostIndicator && Boolean(option.description);

        return (
          <div
            className={cn(
              "relative flex items-center flex-1 pl-2.5 pr-3 hover:bg-vscode-list-hoverBackground",
              hasVisiblePrice ? "py-[3px]" : "py-[5px]",
              option.value === selectedModelId && "pr-8",
            )}
          >
            {option.icon ? (
              <div className="flex-shrink-0 flex items-center justify-center mr-1.5 opacity-80 scale-90">
                {option.icon}
              </div>
            ) : (
              option.codicon && (
                <span
                  slot="start"
                  style={{ fontSize: "14px" }}
                  className={cn("codicon opacity-80 mr-1.5", option.codicon)}
                />
              )
            )}
            <div className="min-w-0 flex flex-1 items-center">
              <div className="min-w-0 flex flex-col">
                <span className="truncate">{option.label}</span>
                {hasVisiblePrice ? (
                  <span
                    className="mt-px text-[8px] font-medium leading-none tracking-[-0.01em] text-vscode-descriptionForeground/45"
                    style={{
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {option.description}
                  </span>
                ) : null}
              </div>
            </div>
            {option.value === selectedModelId && (
              <Check className="absolute right-3 size-4 p-0.5" />
            )}
          </div>
        );
      }}
    />
  );
};
