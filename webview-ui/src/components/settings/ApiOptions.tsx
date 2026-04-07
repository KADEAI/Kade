import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useRegisterSetting } from "./useSettingsSearch";
import { convertHeadersToObject } from "./utils/headers";
import { useDebounce } from "react-use";
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react";
// import { ExternalLinkIcon } from "@radix-ui/react-icons" // kade_change

import {
  type ProviderName,
  type ProviderSettings,
  DEFAULT_CONSECUTIVE_MISTAKE_LIMIT,
  openRouterDefaultModelId,
  requestyDefaultModelId,
  aihubmixDefaultModelId,
  bluesmindsDefaultModelId,
  glamaDefaultModelId, // kade_change
  unboundDefaultModelId,
  litellmDefaultModelId,
  openAiNativeDefaultModelId,
  anthropicDefaultModelId,
  doubaoDefaultModelId,
  claudeCodeDefaultModelId,
  qwenCodeDefaultModelId,
  geminiDefaultModelId,
  geminiCliDefaultModelId,
  deepSeekDefaultModelId,
  moonshotDefaultModelId,
  // kade_change start
  syntheticDefaultModelId,
  ovhCloudAiEndpointsDefaultModelId,
  inceptionDefaultModelId,
  // MODEL_SELECTION_ENABLED,
  // kade_change end
  mistralDefaultModelId,
  xaiDefaultModelId,
  groqDefaultModelId,
  cerebrasDefaultModelId,
  chutesDefaultModelId,
  basetenDefaultModelId,
  bedrockDefaultModelId,
  vertexDefaultModelId,
  sambaNovaDefaultModelId,
  internationalZAiDefaultModelId,
  mainlandZAiDefaultModelId,
  // kade_change start
  opencodeDefaultModelId,
  // kade_change end
  fireworksDefaultModelId,
  featherlessDefaultModelId,
  ioIntelligenceDefaultModelId,
  rooDefaultModelId,
  antigravityDefaultModelId,
  zedDefaultModelId,
  openAiCodexDefaultModelId,
  vercelAiGatewayDefaultModelId,
  deepInfraDefaultModelId,
  minimaxDefaultModelId,
  nanoGptDefaultModelId, //kade_change
  providerForcesCodeBlockToolProtocol,
  type ToolProtocol,
  TOOL_PROTOCOL,
} from "@roo-code/types";
import type { RouterModels } from "@roo/api";

import { vscode } from "@src/utils/vscode";
import { cn } from "@src/lib/utils";
import {
  validateApiConfigurationExcludingModelErrors,
  getModelValidationError,
} from "@src/utils/validate";
import { useAppTranslation } from "@src/i18n/TranslationContext";
import { useRouterModels } from "@src/components/ui/hooks/useRouterModels";
import { useSelectedModel } from "@src/components/ui/hooks/useSelectedModel";
import { useExtensionState } from "@src/context/ExtensionStateContext";
// kade_change start
//import {
//	useOpenRouterModelProviders,
//	OPENROUTER_DEFAULT_PROVIDER_NAME,
//} from "@src/components/ui/hooks/useOpenRouterModelProviders"
// kade_change start
import { filterModels } from "./utils/organizationFilters";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SearchableSelect,
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  // StandardTooltip,
} from "@src/components/ui";

import {
  Antigravity,
  AIHubMix,
  Bluesminds,
  Anthropic,
  Baseten,
  Bedrock,
  Cerebras,
  Chutes,
  ClaudeCode,
  DeepSeek,
  Doubao,
  Gemini,
  Glama, // kade_change
  Groq,
  HuggingFace,
  IOIntelligence,
  LMStudio,
  LiteLLM,
  Mistral,
  Moonshot,
  NanoGpt, // kade_change
  Ollama,
  OpenAI,
  OpenAICodex,
  OpenAICompatible,
  OpenCode,
  OpenRouter,
  QwenCode,
  Requesty,
  Roo,
  SambaNova,
  Unbound,
  Vertex,
  VSCodeLM,
  XAI,
  // kade_change start
  GeminiCli,
  VirtualQuotaFallbackProvider,
  Synthetic,
  OvhCloudAiEndpoints,
  Inception,
  SapAiCore,
  CliProxy,
  Zed,
  // kade_change end
  ZAi,
  Fireworks,
  Featherless,
  VercelAiGateway,
  DeepInfra,
  MiniMax,
  Kiro,
} from "./providers";

import { MODELS_BY_PROVIDER, PROVIDERS } from "./constants";
import { getProviderIcon } from "./providerIcons";
import { getModelAlias } from "@src/utils/model-utils";
import { inputEventTransform, noTransform } from "./transforms";

import { ModelPicker } from "./ModelPicker";
import { ModelInfoView } from "./ModelInfoView";
import { ApiErrorMessage } from "./ApiErrorMessage";
import { ThinkingBudget } from "./ThinkingBudget";
import { Verbosity } from "./Verbosity";
// import { DiffSettingsControl } from "./DiffSettingsControl"
import { TodoListSettingsControl } from "./TodoListSettingsControl";
import { TemperatureControl } from "./TemperatureControl";
import { RateLimitSecondsControl } from "./RateLimitSecondsControl";
import { ConsecutiveMistakeLimitControl } from "./ConsecutiveMistakeLimitControl";
import { BedrockCustomArn } from "./providers/BedrockCustomArn";
import { KiloCode } from "../kilocode/settings/providers/KiloCode"; // kade_change
import { RooBalanceDisplay } from "./providers/RooBalanceDisplay";
import {
  KiloProviderRouting,
  KiloProviderRoutingManagedByOrganization,
} from "./providers/KiloProviderRouting";
import { RateLimitAfterControl } from "./RateLimitAfterSettings"; // kade_change
import ToolProtocolSelector from "./ToolProtocolSelector";
import {
  Sliders,
  ChevronDown,
  Cpu,
  Settings2,
  ExternalLink,
  Terminal,
} from "lucide-react";

const FREE_PROVIDER_GUIDE = [
  {
    label: "Antigravity",
    provider: "antigravity",
    details: [
      "Free trial for new users",
      "Free trial available for pro account",
    ],
  },
  {
    label: "AIHubMix",
    provider: "aihubmix",
    details: [
      "20+ free models available across its broader LLM catalog",
      "Unified access to GPT, Claude, GLM, Gemini, Qwen, and more",
    ],
  },
  {
    label: "Baseten",
    provider: "baseten",
    details: ["Free credits for new accounts"],
  },
  {
    label: "Bluesminds",
    provider: "bluesminds",
    details: [
      "500 free credits for new accounts",
      "Access to OpenAI, Claude, Gemini, MiniMax, and more",
    ],
  },
  {
    label: "Cerebras",
    provider: "cerebras",
    details: [
      "1 million tokens per day free tier",
      "Access to all Cerebras models",
    ],
  },
  {
    label: "CLI OAuth (Google Gemini)",
    provider: undefined,
    details: [
      "Free trial through OAuth",
      "Free trial available for pro account",
    ],
  },
  {
    label: "Featherless AI",
    provider: "featherless",
    details: ["Basic free tier access"],
  },
  {
    label: "Gemini CLI",
    provider: "gemini-cli",
    details: ["Free trial available for pro account"],
  },
  {
    label: "GLM (Z.ai)",
    provider: "zai",
    details: ["Free models including GLM 5"],
  },
  {
    label: "Google Gemini API",
    provider: "gemini",
    details: [
      "Free tier for several models with rate limits",
      "$300 free credits for new customers",
    ],
  },
  {
    label: "Google Vertex AI",
    provider: "vertex",
    details: ["$300 free credits for new customers", "90-day trial period"],
  },
  {
    label: "Groq",
    provider: "groq",
    details: ["Free tier with rate limits", "No credit card required"],
  },
  {
    label: "Hugging Face",
    provider: undefined,
    details: ["Free Inference API tier"],
  },
  {
    label: "Inception Labs",
    provider: "inception",
    details: ["10 million free tokens for new users"],
  },
  {
    label: "Kiro",
    provider: "kiro",
    details: [
      "Offers 500 free credits for Claude on signup",
      "Requires you to download & sign into Kiro and generate an authtoken",
    ],
  },
  {
    label: "Kilo Gateway",
    provider: "kilocode",
    details: [
      "Free models with unlimited usage",
      "GLM 5, Kimi K2.5, MiniMax 2.5, and others",
    ],
  },
  {
    label: "LiteLLM",
    provider: "litellm",
    details: ["Free self-hosted version"],
  },
  {
    label: "LM Studio",
    provider: "lmstudio",
    details: ["Free for personal and commercial use"],
  },
  {
    label: "MiniMax",
    provider: "minimax",
    details: ["Free trial for M2 and other models"],
  },
  {
    label: "Mistral AI",
    provider: "mistral",
    details: ['Free "Experiment" plan for API testing'],
  },
  {
    label: "OpenAI Codex",
    provider: "openai-codex",
    details: ["Free tier available"],
  },
  {
    label: "OpenCode",
    provider: "opencode",
    details: [
      "Free models include GPT-5 Nano plus select MiniMax and MiMo variants",
      "Additional free models are currently offered for a limited time",
    ],
  },
  {
    label: "OpenRouter",
    provider: "openrouter",
    details: ["24+ free models", "No credit card required"],
  },
  {
    label: "Qwen Code",
    provider: "qwen-code",
    details: [
      "2,000 requests per day via OAuth",
      "60 requests per minute rate limit",
    ],
  },
  {
    label: "SambaNova",
    provider: "sambanova",
    details: ["$5 free credit for new users", "30+ million tokens on Llama 8B"],
  },
  {
    label: "Vercel AI Gateway",
    provider: "vercel-ai-gateway",
    details: ["Monthly free credits"],
  },
  {
    label: "xAI (Grok)",
    provider: "xai",
    details: ["Limited free API access"],
  },
  {
    label: "Zed",
    provider: "zed",
    details: [
      "$20 trial credit for 14 days on signup",
      "Hosted Claude, Gemini, and OpenAI models are available",
    ],
  },
] as const;

export interface ApiOptionsProps {
  className?: string;
  uriScheme: string | undefined;
  apiConfiguration: ProviderSettings;
  setApiConfigurationField: <K extends keyof ProviderSettings>(
    field: K,
    value: ProviderSettings[K],
    isUserAction?: boolean,
  ) => void;
  fromWelcomeView?: boolean;
  errorMessage: string | undefined;
  setErrorMessage: React.Dispatch<React.SetStateAction<string | undefined>>;
  hideKiloCodeButton?: boolean; // kade_change
  currentApiConfigName?: string; // kade_change
  showModelOnly?: boolean;
  hideProtocolAndAdvanced?: boolean;
  hideRecommendation?: boolean;
}

const ApiOptions = ({
  uriScheme,
  apiConfiguration,
  setApiConfigurationField,
  fromWelcomeView,
  errorMessage,
  setErrorMessage,
  hideKiloCodeButton = false,
  currentApiConfigName, // kade_change
  showModelOnly,
  hideProtocolAndAdvanced,
  hideRecommendation,
  className,
}: ApiOptionsProps) => {
  const { t } = useAppTranslation();

  const {
    organizationAllowList,
    kilocodeDefaultModel,
    routerModels: extensionRouterModels,
    cloudIsAuthenticated,
    openAiCodexAuthenticated,
    antigravityAuthenticated,
    antigravityEmail,
    antigravityProjectId,
    zedAuthenticated,
    zedGithubLogin,
    geminiCliAuthenticated,
    geminiCliEmail,
    geminiCliProjectId,
    claudeCodeAuthenticated,
  } = useExtensionState();

  if (showModelOnly) {
    return (
      <div className={cn("flex flex-col gap-4", className)}>
        <ModelPicker
          defaultModelId={anthropicDefaultModelId}
          models={null}
          modelIdKey="apiModelId"
          serviceName="Sub-Agent"
          serviceUrl=""
          apiConfiguration={apiConfiguration}
          setApiConfigurationField={setApiConfigurationField}
          organizationAllowList={organizationAllowList}
        />
      </div>
    );
  }

  // Register settings for search
  useRegisterSetting({
    settingId: "provider-select",
    section: "providers",
    label: t("settings:providers.apiProvider"),
  });
  useRegisterSetting({
    settingId: "provider-model",
    section: "providers",
    label: t("settings:providers.model"),
  });
  useRegisterSetting({
    settingId: "advanced-todo-list",
    section: "providers",
    label: t("settings:advanced.todoList.label"),
  });
  useRegisterSetting({
    settingId: "advanced-diff",
    section: "providers",
    label: t("settings:advanced.diff.label"),
  });
  useRegisterSetting({
    settingId: "advanced-temperature",
    section: "providers",
    label: t("settings:temperature.useCustom"),
  });
  useRegisterSetting({
    settingId: "advanced-ratelimit-after",
    section: "providers",
    label: t("settings:providers.rateLimitAfter.label"),
  });
  useRegisterSetting({
    settingId: "advanced-ratelimit-seconds",
    section: "providers",
    label: t("settings:providers.rateLimitSeconds.label"),
  });
  useRegisterSetting({
    settingId: "advanced-mistake-limit",
    section: "providers",
    label: t("settings:providers.consecutiveMistakeLimit.label"),
  });

  const [customHeaders, setCustomHeaders] = useState<[string, string][]>(() => {
    const headers = apiConfiguration?.openAiHeaders || {};
    return Object.entries(headers);
  });
  const [isFreeGuideOpen, setIsFreeGuideOpen] = useState(false);

  useEffect(() => {
    const propHeaders = apiConfiguration?.openAiHeaders || {};

    if (
      JSON.stringify(customHeaders) !==
      JSON.stringify(Object.entries(propHeaders))
    ) {
      setCustomHeaders(Object.entries(propHeaders));
    }
  }, [apiConfiguration?.openAiHeaders, customHeaders]);

  // Helper to convert array of tuples to object (filtering out empty keys).

  // Debounced effect to update the main configuration when local
  // customHeaders state stabilizes.
  useDebounce(
    () => {
      const currentConfigHeaders = apiConfiguration?.openAiHeaders || {};
      const newHeadersObject = convertHeadersToObject(customHeaders);

      // Only update if the processed object is different from the current config.
      if (
        JSON.stringify(currentConfigHeaders) !==
        JSON.stringify(newHeadersObject)
      ) {
        setApiConfigurationField("openAiHeaders", newHeadersObject);
      }
    },
    300,
    [customHeaders, apiConfiguration?.openAiHeaders, setApiConfigurationField],
  );

  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isAdvancedSettingsOpen, setIsAdvancedSettingsOpen] = useState(false);

  const handleInputChange = useCallback(
    <K extends keyof ProviderSettings, E>(
      field: K,
      transform: (event: E) => ProviderSettings[K] = inputEventTransform,
    ) =>
      (event: E | Event) => {
        setApiConfigurationField(field, transform(event as E));
      },
    [setApiConfigurationField],
  );

  const {
    provider: selectedProvider,
    id: selectedModelId,
    info: selectedModelInfo,
  } = useSelectedModel(apiConfiguration);

  const allowNativeToolProtocol =
    !providerForcesCodeBlockToolProtocol(selectedProvider) &&
    selectedModelInfo?.supportsNativeTools !== false;

  // kade_change start: queryKey, chutesApiKey, gemini
  const { data: queriedRouterModels, refetch: refetchRouterModels } = useRouterModels({
    openRouterBaseUrl: apiConfiguration?.openRouterBaseUrl,
    openRouterApiKey: apiConfiguration?.openRouterApiKey,
    aihubmixApiKey: apiConfiguration?.aihubmixApiKey,
    aihubmixBaseUrl: apiConfiguration?.aihubmixBaseUrl,
    bluesmindsApiKey: apiConfiguration?.bluesmindsApiKey,
    bluesmindsBaseUrl: apiConfiguration?.bluesmindsBaseUrl,
    kilocodeOrganizationId:
      apiConfiguration?.kilocodeOrganizationId ?? "personal",
    deepInfraApiKey: apiConfiguration?.deepInfraApiKey,
    geminiApiKey: apiConfiguration?.geminiApiKey,
    googleGeminiBaseUrl: apiConfiguration?.googleGeminiBaseUrl,
    chutesApiKey: apiConfiguration?.chutesApiKey,
    opencodeApiKey: apiConfiguration?.opencodeApiKey,
    syntheticApiKey: apiConfiguration?.syntheticApiKey,
    zedAuthenticated,
  });

  const routerModels: RouterModels | undefined =
    queriedRouterModels || extensionRouterModels
      ? ({
          ...(queriedRouterModels ?? {}),
          ...(extensionRouterModels ?? {}),
        } as RouterModels)
      : undefined;

  //const { data: openRouterModelProviders } = useOpenRouterModelProviders(
  //	apiConfiguration?.openRouterModelId,
  //	apiConfiguration?.openRouterBaseUrl,
  //	apiConfiguration?.openRouterApiKey,
  //	{
  //		enabled:
  //			!!apiConfiguration?.openRouterModelId &&
  //			routerModels?.openrouter &&
  //			Object.keys(routerModels.openrouter).length > 1 &&
  //			apiConfiguration.openRouterModelId in routerModels.openrouter,
  //	},
  //)
  // kade_change end

  // Update `apiModelId` whenever `selectedModelId` changes.
  useEffect(() => {
    if (selectedModelId && apiConfiguration.apiModelId !== selectedModelId) {
      // Pass false as third parameter to indicate this is not a user action
      // This is an internal sync, not a user-initiated change
      setApiConfigurationField("apiModelId", selectedModelId, false);
    }
  }, [selectedModelId, setApiConfigurationField, apiConfiguration.apiModelId]);

  // Debounced refresh model updates, only executed 250ms after the user
  // stops typing.
  useDebounce(
    () => {
      if (selectedProvider === "openai") {
        // Use our custom headers state to build the headers object.
        const headerObject = convertHeadersToObject(customHeaders);

        vscode.postMessage({
          type: "requestOpenAiModels",
          values: {
            baseUrl: apiConfiguration?.openAiBaseUrl,
            apiKey: apiConfiguration?.openAiApiKey,
            customHeaders: {}, // Reserved for any additional headers.
            openAiHeaders: headerObject,
          },
        });
      } else if (selectedProvider === "ollama") {
        vscode.postMessage({ type: "requestOllamaModels" });
      } else if (selectedProvider === "lmstudio") {
        vscode.postMessage({ type: "requestLmStudioModels" });
      } else if (selectedProvider === "vscode-lm") {
        vscode.postMessage({ type: "requestVsCodeLmModels" });
      } else if (
        selectedProvider === "aihubmix" ||
        selectedProvider === "bluesminds" ||
        selectedProvider === "litellm" ||
        selectedProvider === "deepinfra" ||
        selectedProvider === "chutes" || // kade_change
        selectedProvider === "opencode" ||
        selectedProvider === "synthetic" || // kade_change
        selectedProvider === "roo"
      ) {
        vscode.postMessage({ type: "requestRouterModels" });
      } else if (selectedProvider === "zed" && zedAuthenticated) {
        vscode.postMessage({
          type: "requestRouterModels",
          values: { provider: "zed" },
        });
      }
    },
    250,
    [
      selectedProvider,
      zedAuthenticated,
      apiConfiguration?.requestyApiKey,
      apiConfiguration?.openAiBaseUrl,
      apiConfiguration?.openAiApiKey,
      apiConfiguration?.aihubmixApiKey,
      apiConfiguration?.aihubmixBaseUrl,
      apiConfiguration?.bluesmindsApiKey,
      apiConfiguration?.bluesmindsBaseUrl,
      apiConfiguration?.ollamaBaseUrl,
      apiConfiguration?.lmStudioBaseUrl,
      apiConfiguration?.litellmBaseUrl,
      apiConfiguration?.litellmApiKey,
      apiConfiguration?.deepInfraApiKey,
      apiConfiguration?.deepInfraBaseUrl,
      apiConfiguration?.chutesApiKey, // kade_change
      apiConfiguration?.opencodeApiKey,
      apiConfiguration?.ovhCloudAiEndpointsBaseUrl, // kade_change
      customHeaders,
    ],
  );

  useEffect(() => {
    setErrorMessage(undefined);
  }, [apiConfiguration, setErrorMessage]);

  const selectedProviderModels = useMemo(() => {
    let models = MODELS_BY_PROVIDER[selectedProvider];

    // Force inject Kiro models to fix UI display issues
    if (selectedProvider === "kiro") {
      models = {
        "claude-sonnet-4-5": {
          maxTokens: 8192,
          contextWindow: 173_000,
          supportsImages: true,
          supportsPromptCache: true,
          inputPrice: 0,
          outputPrice: 0,
          description: "Claude 4.5 Sonnet (Infinite)",
        },
        "claude-3-5-sonnet-20240620": {
          maxTokens: 8192,
          contextWindow: 200_000,
          supportsImages: true,
          supportsPromptCache: true,
          inputPrice: 0,
          outputPrice: 0,
          description: "Claude 3.5 Sonnet",
        },
      } as any;
    }

    if (!models) return [];

    const filteredModels = filterModels(
      models,
      selectedProvider,
      organizationAllowList,
    );

    // Include the currently selected model even if deprecated (so users can see what they have selected)
    // But filter out other deprecated models from being newly selectable
    const availableModels = filteredModels
      ? Object.entries(filteredModels)
          .filter(([modelId, modelInfo]) => {
            // Always include the currently selected model
            if (modelId === selectedModelId) return true;
            // Filter out deprecated models that aren't currently selected
            return !modelInfo.deprecated;
          })
          .map(([modelId, modelInfo]) => ({
            value: modelId,
            label: getModelAlias(modelId, modelInfo),
          }))
      : [];

    return availableModels;
  }, [selectedProvider, organizationAllowList, selectedModelId]);

  const onProviderChange = useCallback(
    (value: ProviderName) => {
      setApiConfigurationField("apiProvider", value);

      // It would be much easier to have a single attribute that stores
      // the modelId, but we have a separate attribute for each of
      // OpenRouter, Glama, Unbound, and Requesty.
      // If you switch to one of these providers and the corresponding
      // modelId is not set then you immediately end up in an error state.
      // To address that we set the modelId to the default value for th
      // provider if it's not already set.
      const validateAndResetModel = (
        modelId: string | undefined,
        field: keyof ProviderSettings,
        defaultValue?: string,
      ) => {
        // in case we haven't set a default value for a provider
        if (!defaultValue) return;

        // Default to first model when provider changes to avoid sticky selections
        setApiConfigurationField(field, defaultValue, false);
      };

      // Define a mapping object that associates each provider with its model configuration
      const PROVIDER_MODEL_CONFIG: Partial<
        Record<
          ProviderName,
          {
            field: keyof ProviderSettings;
            default?: string;
          }
        >
      > = {
        deepinfra: {
          field: "deepInfraModelId",
          default: deepInfraDefaultModelId,
        },
        openrouter: {
          field: "openRouterModelId",
          default: openRouterDefaultModelId,
        },
        aihubmix: { field: "apiModelId", default: aihubmixDefaultModelId },
        bluesminds: {
          field: "apiModelId",
          default: bluesmindsDefaultModelId,
        },
        glama: { field: "glamaModelId", default: glamaDefaultModelId }, // kade_change
        unbound: { field: "unboundModelId", default: unboundDefaultModelId },
        requesty: { field: "requestyModelId", default: requestyDefaultModelId },
        litellm: { field: "litellmModelId", default: litellmDefaultModelId },
        "nano-gpt": { field: "nanoGptModelId", default: nanoGptDefaultModelId }, // kade_change
        opencode: { field: "opencodeModelId", default: opencodeDefaultModelId }, // kade_change
        anthropic: { field: "apiModelId", default: anthropicDefaultModelId },
        cerebras: { field: "apiModelId", default: cerebrasDefaultModelId },
        "claude-code": {
          field: "apiModelId",
          default: claudeCodeDefaultModelId,
        },
        "qwen-code": { field: "apiModelId", default: qwenCodeDefaultModelId },
        "openai-native": {
          field: "apiModelId",
          default: openAiNativeDefaultModelId,
        },
        gemini: { field: "apiModelId", default: geminiDefaultModelId },
        deepseek: { field: "apiModelId", default: deepSeekDefaultModelId },
        doubao: { field: "apiModelId", default: doubaoDefaultModelId },
        moonshot: { field: "apiModelId", default: moonshotDefaultModelId },
        minimax: { field: "apiModelId", default: minimaxDefaultModelId },
        mistral: { field: "apiModelId", default: mistralDefaultModelId },
        xai: { field: "apiModelId", default: xaiDefaultModelId },
        groq: { field: "apiModelId", default: groqDefaultModelId },
        chutes: { field: "apiModelId", default: chutesDefaultModelId },
        baseten: { field: "apiModelId", default: basetenDefaultModelId },
        bedrock: { field: "apiModelId", default: bedrockDefaultModelId },
        vertex: { field: "apiModelId", default: vertexDefaultModelId },
        sambanova: { field: "apiModelId", default: sambaNovaDefaultModelId },
        zai: {
          field: "apiModelId",
          default:
            apiConfiguration.zaiApiLine === "china_coding"
              ? mainlandZAiDefaultModelId
              : internationalZAiDefaultModelId,
        },
        fireworks: { field: "apiModelId", default: fireworksDefaultModelId },
        featherless: {
          field: "apiModelId",
          default: featherlessDefaultModelId,
        },
        "io-intelligence": {
          field: "ioIntelligenceModelId",
          default: ioIntelligenceDefaultModelId,
        },
        roo: { field: "apiModelId", default: rooDefaultModelId },
        "vercel-ai-gateway": {
          field: "vercelAiGatewayModelId",
          default: vercelAiGatewayDefaultModelId,
        },
        "openai-codex": {
          field: "apiModelId",
          default: openAiCodexDefaultModelId,
        },
        openai: { field: "openAiModelId" },
        ollama: { field: "ollamaModelId" },
        lmstudio: { field: "lmStudioModelId" },
        // kade_change start
        kilocode: { field: "kilocodeModel", default: kilocodeDefaultModel },
        antigravity: {
          field: "apiModelId",
          default: antigravityDefaultModelId,
        },
        zed: { field: "apiModelId", default: zedDefaultModelId },
        kiro: { field: "apiModelId" },

        "gemini-cli": { field: "apiModelId", default: geminiCliDefaultModelId },
        synthetic: { field: "apiModelId", default: syntheticDefaultModelId },
        ovhcloud: {
          field: "ovhCloudAiEndpointsModelId",
          default: ovhCloudAiEndpointsDefaultModelId,
        },
        inception: {
          field: "inceptionLabsModelId",
          default: inceptionDefaultModelId,
        },
        // kade_change end
      };

      const config = PROVIDER_MODEL_CONFIG[value];
      if (config) {
        let defaultValue = config.default;

        // Fallback to first model in manifest if no explicit default is defined
        if (!defaultValue) {
          let models = MODELS_BY_PROVIDER[value];
          if (value === "kiro") {
            models = { "claude-sonnet-4-5": {} } as any;
          }
          if (models) {
            const modelIds = Object.keys(models);
            if (modelIds.length > 0) {
              defaultValue = modelIds[0];
            }
          }
        }

        validateAndResetModel(
          apiConfiguration[config.field] as string | undefined,
          config.field,
          defaultValue,
        );
      }
    },
    [setApiConfigurationField, apiConfiguration, kilocodeDefaultModel],
  );

  const modelValidationError = useMemo(() => {
    return getModelValidationError(
      apiConfiguration,
      routerModels,
      organizationAllowList,
    );
  }, [apiConfiguration, routerModels, organizationAllowList]);

  const selectedToolProtocol = allowNativeToolProtocol
    ? apiConfiguration.toolProtocol || TOOL_PROTOCOL.JSON
    : TOOL_PROTOCOL.UNIFIED;

  useEffect(() => {
    if (
      !allowNativeToolProtocol &&
      apiConfiguration.toolProtocol !== TOOL_PROTOCOL.UNIFIED
    ) {
      setApiConfigurationField("toolProtocol", TOOL_PROTOCOL.UNIFIED, false);
    }
  }, [
    allowNativeToolProtocol,
    apiConfiguration.toolProtocol,
    setApiConfigurationField,
  ]);

  // Show the tool protocol selector for all providers.
  // const showToolProtocolSelector = true

  // Convert providers to SearchableSelect options
  // kade_change start: no organizationAllowList
  const providerOptions = PROVIDERS.filter(
    ({ value }) => value !== "cli-proxy" || selectedProvider === "cli-proxy",
  ).map(({ value, label }) => {
    return {
      value,
      label,
      icon: getProviderIcon(value, "mr-2"),
    };
  });

  const selectedFreeProviderGuide = useMemo(
    () =>
      FREE_PROVIDER_GUIDE.find((entry) => entry.provider === selectedProvider),
    [selectedProvider],
  );
  // kade_change end

  return (
    <div className="flex flex-col gap-6">
      <div
        className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl overflow-hidden"
        data-setting-id="provider-select"
      >
        <div className="flex justify-between items-center gap-4 border-b border-vscode-input-border/50 pb-2">
          <div className="flex items-center gap-2 min-w-0">
            <Cpu className="size-3.5 text-vscode-foreground shrink-0" />
            <label className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80 truncate">
              {t("settings:providers.apiProvider")}
            </label>
          </div>
          {selectedProvider === "roo" && cloudIsAuthenticated ? (
            <RooBalanceDisplay />
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <SearchableSelect
            value={selectedProvider}
            onValueChange={(value) => onProviderChange(value as ProviderName)}
            options={providerOptions}
            placeholder={t("settings:common.select")}
            searchPlaceholder={t(
              "settings:providers.searchProviderPlaceholder",
            )}
            emptyMessage={t("settings:providers.noProviderMatchFound")}
            className="flex-1 text-[13px] min-w-0"
            data-testid="provider-select"
          />
          {(() => {
            const provider = PROVIDERS.find(
              (p) => p.value === selectedProvider,
            );
            return (
              provider?.website && (
                <VSCodeLink
                  href={provider.website}
                  target="_blank"
                  title={t("settings:providers.visitWebsite", {
                    name: provider.label,
                  })}
                  className="flex shrink-0 items-center justify-center p-1 hover:bg-vscode-toolbar-hoverBackground rounded"
                >
                  <ExternalLink className="size-4 text-vscode-descriptionForeground hover:text-vscode-link-activeForeground transition-colors" />
                </VSCodeLink>
              )
            );
          })()}
        </div>

        {errorMessage && <ApiErrorMessage errorMessage={errorMessage} />}

        {!hideRecommendation && (
          <div className="min-w-0 overflow-hidden rounded-[12px] border border-vscode-input-border/40 bg-vscode-editor-background/16">
            <button
              type="button"
              onClick={() => setIsFreeGuideOpen((open) => !open)}
              className="flex w-full flex-col items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-vscode-toolbar-hoverBackground/15"
              data-testid="free-provider-guide-toggle"
            >
              <div className="min-w-0 w-full">
                <div className="text-[11px] font-medium leading-4 text-vscode-foreground">
                  Free Provider Guide
                </div>
                <div className="mt-0.5 text-[10px] leading-4 text-vscode-descriptionForeground">
                  Free tiers, trials, credits, and OAuth options.
                </div>
              </div>
              <div className="flex w-full items-center justify-between gap-2 border-t border-vscode-input-border/8 pt-1.5">
                <span className="text-[9px] uppercase tracking-[0.1em] text-vscode-descriptionForeground/70">
                  {FREE_PROVIDER_GUIDE.length} listed
                </span>
                <ChevronDown
                  className={cn(
                    "size-3.5 text-vscode-descriptionForeground/70 transition-transform",
                    isFreeGuideOpen && "rotate-180",
                  )}
                />
              </div>
            </button>

            {selectedFreeProviderGuide && (
              <div className="border-t border-vscode-input-border/10 px-3 py-2">
                <div className="flex items-start gap-2 text-[10px] leading-4 text-vscode-descriptionForeground">
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-emerald-400/85" />
                  <div className="min-w-0">
                    <span className="font-medium text-vscode-foreground">
                      Free access available.
                    </span>{" "}
                    {selectedFreeProviderGuide.details[0]}
                  </div>
                </div>
              </div>
            )}

            {isFreeGuideOpen && (
              <div
                className="flex min-w-0 flex-col gap-2 border-t border-vscode-input-border/10 px-3 py-2.5"
                data-testid="free-provider-guide-content"
              >
                <div className="break-words break-anywhere text-[10px] leading-4 text-vscode-descriptionForeground">
                  Free tiers can change over time and may include rate limits or
                  trial restrictions.
                </div>
                <div className="grid min-w-0 max-h-72 gap-1 overflow-y-auto pr-1">
                  {FREE_PROVIDER_GUIDE.map((entry) => {
                    const isSelected = entry.provider === selectedProvider;
                    return (
                      <div
                        key={entry.label}
                        className={cn(
                          "flex min-w-0 flex-col gap-0.5 rounded-[10px] border px-2.5 py-1.5 transition-colors",
                          isSelected
                            ? "border-emerald-500/20 bg-emerald-500/6"
                            : "border-vscode-input-border/10 bg-vscode-editor-background/12",
                        )}
                      >
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <span className="min-w-0 break-words break-anywhere text-[11px] font-medium text-vscode-foreground">
                            {entry.label}
                          </span>
                          {isSelected ? (
                            <span className="text-[9px] uppercase tracking-[0.08em] text-emerald-300/90">
                              Selected
                            </span>
                          ) : null}
                        </div>
                        <ul className="min-w-0 list-disc space-y-0.5 pl-3 text-[10px] leading-4 text-vscode-descriptionForeground marker:text-vscode-descriptionForeground/50">
                          {entry.details.map((detail) => (
                            <li
                              key={detail}
                              className="break-words break-anywhere"
                            >
                              {detail}
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Configuration Card */}
      <div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-xl">
        <div className="flex flex-col gap-2 pb-2 relative after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[1px] after:bg-gradient-to-r after:from-transparent after:via-vscode-input-border/50 after:to-transparent">
          <div className="flex items-center gap-2">
            <Settings2 className="size-3.5 text-vscode-foreground" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80 shrink-0">
              Configuration
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {/* kade_change start */}
          {selectedProvider === "kilocode" && (
            <KiloCode
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              hideKiloCodeButton={hideKiloCodeButton}
              currentApiConfigName={currentApiConfigName}
              routerModels={routerModels}
              organizationAllowList={organizationAllowList}
              kilocodeDefaultModel={kilocodeDefaultModel}
            />
          )}
          {/* kade_change end */}

          {selectedProvider === "antigravity" && (
            <Antigravity
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              antigravityIsAuthenticated={antigravityAuthenticated}
              antigravityEmail={antigravityEmail}
              antigravityProjectId={antigravityProjectId}
              organizationAllowList={organizationAllowList}
            />
          )}

          {selectedProvider === "zed" && (
            <Zed
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              routerModels={routerModels}
              zedIsAuthenticated={zedAuthenticated}
              zedGithubLogin={zedGithubLogin}
              organizationAllowList={organizationAllowList}
              modelValidationError={modelValidationError}
              simplifySettings={fromWelcomeView}
            />
          )}

          {selectedProvider === "kiro" && (
            <Kiro
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
            />
          )}

          {selectedProvider === "openrouter" && (
            <OpenRouter
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              routerModels={routerModels}
              selectedModelId={selectedModelId}
              uriScheme={uriScheme}
              simplifySettings={fromWelcomeView}
              organizationAllowList={organizationAllowList}
              modelValidationError={modelValidationError}
            />
          )}

          {selectedProvider === "requesty" && (
            <Requesty
              uriScheme={uriScheme}
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              routerModels={routerModels}
              refetchRouterModels={refetchRouterModels}
              organizationAllowList={organizationAllowList}
              modelValidationError={modelValidationError}
              simplifySettings={fromWelcomeView}
            />
          )}

          {
            /* kade_change start */
            selectedProvider === "glama" && (
              <Glama
                apiConfiguration={apiConfiguration}
                setApiConfigurationField={setApiConfigurationField}
                routerModels={routerModels}
                uriScheme={uriScheme}
                organizationAllowList={organizationAllowList}
                modelValidationError={modelValidationError}
                simplifySettings={fromWelcomeView}
              />
            )
            /* kade_change end */
          }

          {selectedProvider === "aihubmix" && (
            <AIHubMix
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              routerModels={routerModels}
              refetchRouterModels={refetchRouterModels}
              organizationAllowList={organizationAllowList}
              modelValidationError={modelValidationError}
              simplifySettings={fromWelcomeView}
            />
          )}

          {selectedProvider === "bluesminds" && (
            <Bluesminds
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              routerModels={routerModels}
              refetchRouterModels={refetchRouterModels}
              organizationAllowList={organizationAllowList}
              modelValidationError={modelValidationError}
              simplifySettings={fromWelcomeView}
            />
          )}

          {selectedProvider === "opencode" && (
            <OpenCode
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              routerModels={routerModels}
              refetchRouterModels={refetchRouterModels}
              organizationAllowList={organizationAllowList}
              modelValidationError={modelValidationError}
              simplifySettings={fromWelcomeView}
            />
          )}

          {selectedProvider === "unbound" && (
            <Unbound
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              routerModels={routerModels}
              organizationAllowList={organizationAllowList}
              modelValidationError={modelValidationError}
              simplifySettings={fromWelcomeView}
            />
          )}

          {selectedProvider === "deepinfra" && (
            <DeepInfra
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              routerModels={routerModels}
              refetchRouterModels={refetchRouterModels}
              organizationAllowList={organizationAllowList}
              modelValidationError={modelValidationError}
              simplifySettings={fromWelcomeView}
            />
          )}

          {/* kade_change start */}
          {selectedProvider === "inception" && (
            <Inception
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              routerModels={routerModels}
              refetchRouterModels={refetchRouterModels}
              organizationAllowList={organizationAllowList}
              modelValidationError={modelValidationError}
            />
          )}
          {/* kade_change end */}

          {/* kade_change start */}

          {/* kade_change start */}
          {selectedProvider === "cli-proxy" && (
            <CliProxy
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
            />
          )}
          {/* kade_change end */}

          {selectedProvider === "anthropic" && (
            <Anthropic
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              simplifySettings={fromWelcomeView}
            />
          )}

          {selectedProvider === "claude-code" && (
            <ClaudeCode claudeCodeIsAuthenticated={claudeCodeAuthenticated} />
          )}

          {selectedProvider === "openai-native" && (
            <OpenAI
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              selectedModelInfo={selectedModelInfo}
              simplifySettings={fromWelcomeView}
            />
          )}

          {/* kade_change start */}
          {selectedProvider === "ovhcloud" && (
            <OvhCloudAiEndpoints
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              routerModels={routerModels}
              organizationAllowList={organizationAllowList}
              modelValidationError={modelValidationError}
            />
          )}
          {/* kade_change end */}

          {selectedProvider === "mistral" && (
            <Mistral
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              simplifySettings={fromWelcomeView}
            />
          )}

          {selectedProvider === "baseten" && (
            <Baseten
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              simplifySettings={fromWelcomeView}
            />
          )}

          {selectedProvider === "bedrock" && (
            <Bedrock
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              selectedModelInfo={selectedModelInfo}
              simplifySettings={fromWelcomeView}
            />
          )}

          {selectedProvider === "vertex" && (
            <Vertex
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              simplifySettings={fromWelcomeView}
            />
          )}

          {selectedProvider === "gemini" && (
            // kade_change: added props
            <Gemini
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              fromWelcomeView={fromWelcomeView}
              routerModels={routerModels}
              organizationAllowList={organizationAllowList}
              modelValidationError={modelValidationError}
            />
          )}

          {selectedProvider === "openai" && (
            <OpenAICompatible
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              organizationAllowList={organizationAllowList}
              modelValidationError={modelValidationError}
              simplifySettings={fromWelcomeView}
            />
          )}

          {selectedProvider === "openai-codex" && (
            <OpenAICodex
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              openAiCodexIsAuthenticated={openAiCodexAuthenticated}
              organizationAllowList={organizationAllowList}
            />
          )}

          {selectedProvider === "lmstudio" && (
            <LMStudio
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              simplifySettings={fromWelcomeView}
            />
          )}

          {selectedProvider === "deepseek" && (
            <DeepSeek
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              simplifySettings={fromWelcomeView}
            />
          )}

          {selectedProvider === "doubao" && (
            <Doubao
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              simplifySettings={fromWelcomeView}
            />
          )}

          {selectedProvider === "qwen-code" && (
            <QwenCode
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              simplifySettings={fromWelcomeView}
            />
          )}

          {selectedProvider === "moonshot" && (
            <Moonshot
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              simplifySettings={fromWelcomeView}
            />
          )}

          {selectedProvider === "minimax" && (
            <MiniMax
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
            />
          )}

          {/* kade_change start */}
          {selectedProvider === "nano-gpt" && (
            <NanoGpt
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              routerModels={routerModels}
              organizationAllowList={organizationAllowList}
              modelValidationError={modelValidationError}
            />
          )}
          {/* kade_change end */}

          {selectedProvider === "vscode-lm" && (
            <VSCodeLM
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
            />
          )}

          {selectedProvider === "ollama" && (
            <Ollama
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
            />
          )}

          {selectedProvider === "xai" && (
            <XAI
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
            />
          )}

          {selectedProvider === "groq" && (
            <Groq
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
            />
          )}

          {selectedProvider === "huggingface" && (
            <HuggingFace
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
            />
          )}

          {selectedProvider === "cerebras" && (
            <Cerebras
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
            />
          )}

          {selectedProvider === "chutes" && (
            <Chutes
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              routerModels={routerModels}
              organizationAllowList={organizationAllowList}
              modelValidationError={modelValidationError}
              simplifySettings={fromWelcomeView}
            />
          )}

          {/* kade_change start */}
          {selectedProvider === "gemini-cli" && (
            <GeminiCli
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              geminiCliIsAuthenticated={geminiCliAuthenticated}
              geminiCliEmail={geminiCliEmail}
              geminiCliProjectId={geminiCliProjectId}
              organizationAllowList={organizationAllowList}
            />
          )}

          {selectedProvider === "virtual-quota-fallback" && (
            <VirtualQuotaFallbackProvider
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
            />
          )}
          {/* kade_change end */}

          {selectedProvider === "litellm" && (
            <LiteLLM
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              organizationAllowList={organizationAllowList}
              modelValidationError={modelValidationError}
              simplifySettings={fromWelcomeView}
            />
          )}

          {selectedProvider === "sambanova" && (
            <SambaNova
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
            />
          )}

          {selectedProvider === "zai" && (
            <ZAi
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
            />
          )}

          {selectedProvider === "io-intelligence" && (
            <IOIntelligence
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              organizationAllowList={organizationAllowList}
              modelValidationError={modelValidationError}
              simplifySettings={fromWelcomeView}
            />
          )}

          {selectedProvider === "vercel-ai-gateway" && (
            <VercelAiGateway
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              routerModels={routerModels}
              organizationAllowList={organizationAllowList}
              modelValidationError={modelValidationError}
              simplifySettings={fromWelcomeView}
            />
          )}

          {selectedProvider === "human-relay" && (
            <>
              <div className="text-sm text-vscode-descriptionForeground">
                {t("settings:providers.humanRelay.description")}
              </div>
              <div className="text-sm text-vscode-descriptionForeground">
                {t("settings:providers.humanRelay.instructions")}
              </div>
            </>
          )}

          {selectedProvider === "fireworks" && (
            <Fireworks
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
            />
          )}

          {
            selectedProvider === "synthetic" && (
              <Synthetic
                apiConfiguration={apiConfiguration}
                setApiConfigurationField={setApiConfigurationField}
                routerModels={routerModels}
                organizationAllowList={organizationAllowList}
                modelValidationError={modelValidationError}
              />
            )
            // kade_change end
          }

          {selectedProvider === "roo" && (
            <Roo
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              routerModels={routerModels}
              cloudIsAuthenticated={cloudIsAuthenticated}
              organizationAllowList={organizationAllowList}
              modelValidationError={modelValidationError}
              simplifySettings={fromWelcomeView}
            />
          )}

          {selectedProvider === "featherless" && (
            <Featherless
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
            />
          )}

          {/* kade_change start */}
          {selectedProvider === "sap-ai-core" && (
            <SapAiCore
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
            />
          )}
          {/* kade_change end */}

          {selectedProviderModels.length > 0 &&
            !["openai-codex", "antigravity", "gemini-cli"].includes(
              selectedProvider,
            ) && (
              <>
                <div data-setting-id="provider-model">
                  <label className="block font-medium mb-1">
                    {t("settings:providers.model")}
                  </label>
                  <Select
                    value={
                      selectedModelId === "custom-arn"
                        ? "custom-arn"
                        : selectedModelId
                    }
                    onValueChange={(value) => {
                      setApiConfigurationField("apiModelId", value);

                      // Clear custom ARN if not using custom ARN option.
                      if (
                        value !== "custom-arn" &&
                        selectedProvider === "bedrock"
                      ) {
                        setApiConfigurationField("awsCustomArn", "");
                      }

                      // Clear reasoning effort when switching models to allow the new model's default to take effect
                      // This is especially important for GPT-5 models which default to "medium"
                      if (selectedProvider === "openai-native") {
                        setApiConfigurationField("reasoningEffort", undefined);
                      }
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("settings:common.select")} />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedProviderModels.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          <div className="flex items-center gap-2">
                            {getProviderIcon(option.value)}
                            <span>{option.label}</span>
                          </div>
                        </SelectItem>
                      ))}
                      {selectedProvider === "bedrock" && (
                        <SelectItem value="custom-arn">
                          {t("settings:labels.useCustomArn")}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>

                {/* Show error if a deprecated model is selected */}
                {selectedModelInfo?.deprecated && (
                  <ApiErrorMessage
                    errorMessage={t("settings:validation.modelDeprecated")}
                  />
                )}

                {selectedProvider === "bedrock" &&
                  selectedModelId === "custom-arn" && (
                    <BedrockCustomArn
                      apiConfiguration={apiConfiguration}
                      setApiConfigurationField={setApiConfigurationField}
                    />
                  )}

                {/* Only show model info if not deprecated and not already shown by a provider that uses ModelPicker */}
                {!selectedModelInfo?.deprecated &&
                  ![
                    "kilocode",
                    "openrouter",
                    "glama",
                    "unbound",
                    "requesty",
                    "litellm",
                    "deepinfra",
                    "nano-gpt",
                    "ovhcloud",
                    "inception",
                    "gemini",
                    "openai-codex",
                    "antigravity",
                    "gemini-cli",
                  ].includes(selectedProvider) && (
                    <div className="rounded-xl border border-vscode-textBlockQuote-border/15 bg-vscode-textBlockQuote-background/30 p-3">
                      <ModelInfoView
                        apiProvider={selectedProvider}
                        selectedModelId={selectedModelId}
                        modelInfo={selectedModelInfo}
                        isDescriptionExpanded={isDescriptionExpanded}
                        setIsDescriptionExpanded={setIsDescriptionExpanded}
                      />
                    </div>
                  )}
              </>
            )}

          {!fromWelcomeView && (
            <ThinkingBudget
              key={`${selectedProvider}-${selectedModelId}`}
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              modelInfo={selectedModelInfo}
            />
          )}

          {/* Gate Verbosity UI by capability flag */}
          {!fromWelcomeView && selectedModelInfo?.supportsVerbosity && (
            <Verbosity
              apiConfiguration={apiConfiguration}
              setApiConfigurationField={setApiConfigurationField}
              modelInfo={selectedModelInfo}
            />
          )}

          {
            // kade_change start
            (selectedProvider === "kilocode" ||
              selectedProvider === "openrouter") &&
              (apiConfiguration.kilocodeOrganizationId ? (
                <KiloProviderRoutingManagedByOrganization
                  organizationId={apiConfiguration.kilocodeOrganizationId}
                />
              ) : (
                <KiloProviderRouting
                  apiConfiguration={apiConfiguration}
                  setApiConfigurationField={setApiConfigurationField}
                  kilocodeDefaultModel={kilocodeDefaultModel}
                />
              ))
            // kade_change end
          }
        </div>
      </div>
      {!fromWelcomeView &&
        selectedProvider !== ("virtual-quota-fallback" as any) &&
        !hideProtocolAndAdvanced && (
          <div className="flex flex-col gap-4">
            <div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 p-5 flex flex-col gap-5 shadow-sm">
              <div className="flex items-center gap-2 pb-2 relative after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[1px] after:bg-gradient-to-r after:from-transparent after:via-vscode-input-border/50 after:to-transparent">
                <Terminal className="size-3.5 text-vscode-foreground" />
                <span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
                  Protocol Selection
                </span>
              </div>
              <ToolProtocolSelector
                value={selectedToolProtocol as ToolProtocol}
                onChange={(value) =>
                  setApiConfigurationField("toolProtocol", value)
                }
                allowNativeProtocol={allowNativeToolProtocol}
                unifiedFormatVariant={
                  apiConfiguration.unifiedFormatVariant || "structured"
                }
                onUnifiedFormatVariantChange={(value) =>
                  setApiConfigurationField("unifiedFormatVariant", value)
                }
                disableBatchToolUse={apiConfiguration.disableBatchToolUse}
                onDisableBatchToolUseChange={(value) =>
                  setApiConfigurationField("disableBatchToolUse", value)
                }
                maxToolCalls={apiConfiguration.maxToolCalls}
                onMaxToolCallsChange={(value) =>
                  setApiConfigurationField("maxToolCalls", value)
                }
                minimalSystemPrompt={apiConfiguration.minimalSystemPrompt}
                onMinimalSystemPromptChange={(value) =>
                  setApiConfigurationField("minimalSystemPrompt", value)
                }
              />
            </div>
            <div className="rounded-[24px] border border-vscode-input-border/30 bg-vscode-editor-background/40 flex flex-col shadow-xl overflow-hidden">
              <Collapsible
                open={isAdvancedSettingsOpen}
                onOpenChange={setIsAdvancedSettingsOpen}
              >
                <CollapsibleTrigger className="flex items-center gap-2 w-full p-5 cursor-pointer hover:bg-vscode-input-border/10 transition-colors">
                  <div className="flex flex-1 items-center gap-2">
                    <Sliders className="size-3.5 text-vscode-foreground" />
                    <span className="text-[11px] font-bold uppercase tracking-widest text-vscode-foreground/80">
                      {t("settings:advancedSettings.title")}
                    </span>
                  </div>
                  <div
                    className={cn(
                      "transition-transform duration-200",
                      isAdvancedSettingsOpen ? "rotate-180" : "",
                    )}
                  >
                    <ChevronDown className="size-4 text-vscode-descriptionForeground" />
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent className="px-5 pb-5 flex flex-col gap-6">
                  <div className="border-t border-vscode-input-border/50 pt-5 flex flex-col gap-6">
                    <TodoListSettingsControl
                      todoListEnabled={apiConfiguration.todoListEnabled}
                      onChange={(field: any, value: any) =>
                        setApiConfigurationField(field, value)
                      }
                    />
                    {/* <DiffSettingsControl
										diffEnabled={apiConfiguration.diffEnabled}
										fuzzyMatchThreshold={apiConfiguration.fuzzyMatchThreshold}
										onChange={(field, value) => setApiConfigurationField(field, value)}
									/> */}
                    {selectedModelInfo?.supportsTemperature !== false && (
                      <TemperatureControl
                        value={apiConfiguration.modelTemperature}
                        onChange={handleInputChange(
                          "modelTemperature",
                          noTransform,
                        )}
                        maxValue={2}
                        defaultValue={selectedModelInfo?.defaultTemperature}
                      />
                    )}
                    {
                      // kade_change start
                      <RateLimitAfterControl
                        rateLimitAfterEnabled={apiConfiguration.rateLimitAfter}
                        onChange={(field, value) =>
                          setApiConfigurationField(field, value)
                        }
                      />
                      // kade_change end
                    }
                    <RateLimitSecondsControl
                      value={apiConfiguration.rateLimitSeconds || 0}
                      onChange={(value) =>
                        setApiConfigurationField("rateLimitSeconds", value)
                      }
                    />
                    <ConsecutiveMistakeLimitControl
                      value={
                        apiConfiguration.consecutiveMistakeLimit !== undefined
                          ? apiConfiguration.consecutiveMistakeLimit
                          : DEFAULT_CONSECUTIVE_MISTAKE_LIMIT
                      }
                      onChange={(value) =>
                        setApiConfigurationField(
                          "consecutiveMistakeLimit",
                          value,
                        )
                      }
                    />
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </div>
        )}
    </div>
  );
};

export default memo(ApiOptions);
