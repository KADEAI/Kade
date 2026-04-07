import { ModelSelector } from "./chat/ModelSelector";
import { useExtensionState } from "@/context/ExtensionStateContext";
import { useSelectedModel } from "../ui/hooks/useSelectedModel";

export const BottomApiConfig = () => {
  const { currentApiConfigName, apiConfiguration, virtualQuotaActiveModel } =
    useExtensionState(); // kade_change: Get virtual quota active model for UI display
  const { id: selectedModelId, provider: selectedProvider } =
    useSelectedModel(apiConfiguration);

  if (!apiConfiguration) {
    return null;
  }

  return (
    <>
      {/* kade_change - add data-testid="model-selector" below */}
      <div className="w-auto overflow-hidden" data-testid="model-selector">
        <ModelSelector
          currentApiConfigName={currentApiConfigName}
          apiConfiguration={apiConfiguration}
          fallbackText={`${selectedProvider}:${selectedModelId}`}
          //kade_change: Pass virtual quota active model to ModelSelector
          virtualQuotaActiveModel={
            virtualQuotaActiveModel
              ? {
                  id: virtualQuotaActiveModel.id,
                  name: virtualQuotaActiveModel.id,
                }
              : undefined
          }
        />
      </div>
    </>
  );
};
