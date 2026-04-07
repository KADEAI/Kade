import { memo, useState, useMemo } from "react";
import { Trans } from "react-i18next";
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react";

import { vscode } from "@src/utils/vscode";
import { useAppTranslation } from "@src/i18n/TranslationContext";
import { useExtensionState } from "../../context/ExtensionStateContext";

interface BannerConfig {
  id: string;
  title: string;
  messageKey: string;
  canDismiss: boolean;
  action?: {
    text: string;
    handler: () => void;
  };
}

const FirstInstallBanners: BannerConfig[] = [
  {
    id: "welcome",
    title: "🚀 Welcome to Kade: AI Coding Agent!",
    messageKey: "welcome:welcome.message",
    canDismiss: true,
  },
  {
    id: "provider",
    title: "🎯 Ready to code?",
    messageKey: "welcome:provider.message",
    canDismiss: true,
    action: {
      text: "welcome:provider.actionText",
      handler: () => {
        window.postMessage({
          type: "action",
          action: "settingsButtonClicked",
          values: { section: "provider" },
        });
      },
    },
  },
  {
    id: "toolProtocol",
    title: "⚡ Pro tip: Tool Protocol",
    messageKey: "welcome:toolProtocol.proTipMessage",
    canDismiss: true,
    action: {
      text: "welcome:toolProtocol.actionText",
      handler: () => {
        window.postMessage({
          type: "action",
          action: "settingsButtonClicked",
          values: { section: "provider" },
        });
      },
    },
  },
  {
    id: "telemetry",
    title: "welcome:telemetry.helpImprove",
    messageKey: "welcome:telemetry.helpImproveMessage",
    canDismiss: true,
  },
];

const FirstInstallBannerCarousel = () => {
  const { t } = useAppTranslation();
  const { dismissedUpsells = [] } = useExtensionState();
  const [currentBannerIndex, setCurrentBannerIndex] = useState(0);
  const [localDismissedBanners, setLocalDismissedBanners] = useState<
    Set<string>
  >(new Set());

  // Filter out dismissed banners (both local and persisted)
  const availableBanners = useMemo(() => {
    return FirstInstallBanners.filter(
      (banner) =>
        !localDismissedBanners.has(banner.id) &&
        !dismissedUpsells.includes(`first_install_${banner.id}`),
    );
  }, [localDismissedBanners, dismissedUpsells]);

  // If no banners left, don't render anything
  if (availableBanners.length === 0) {
    return null;
  }

  const currentBanner =
    availableBanners[currentBannerIndex % availableBanners.length];

  const handleDismiss = () => {
    const bannerId = currentBanner.id;
    setLocalDismissedBanners((prev) => new Set([...prev, bannerId]));

    // Persist dismissal
    vscode.postMessage({
      type: "dismissUpsell",
      upsellId: `first_install_${bannerId}`,
    });

    // Move to next banner if available
    if (availableBanners.length > 1) {
      setCurrentBannerIndex((prev) => prev + 1);
    }
  };

  const handleAction = () => {
    if (currentBanner.action) {
      currentBanner.action.handler();
    }
    // Mark as completed when action is taken
    handleDismiss();
  };

  return (
    <div className="relative p-4 pr-10 bg-vscode-editor-background border border-vscode-panel-border rounded text-sm leading-normal text-vscode-foreground">
      {/* Close button */}
      {currentBanner.canDismiss && (
        <button
          onClick={handleDismiss}
          className="absolute top-1.5 right-2 bg-transparent border-none text-vscode-foreground cursor-pointer text-2xl p-1 opacity-70 hover:opacity-100 transition-opacity duration-200 leading-none"
          aria-label="Close"
        >
          ×
        </button>
      )}

      {/* Banner navigation dots */}
      {availableBanners.length > 1 && (
        <div className="absolute top-1.5 left-2 flex gap-1">
          {availableBanners.map((_, index) => (
            <div
              key={index}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                index === currentBannerIndex % availableBanners.length
                  ? "bg-vscode-foreground"
                  : "bg-vscode-foreground/30"
              }`}
            />
          ))}
        </div>
      )}

      <div className="mb-0.5 font-bold text-base">
        {currentBanner.title.startsWith("welcome:")
          ? t(currentBanner.title)
          : currentBanner.title}
      </div>
      <div className="mb-2">
        <Trans
          i18nKey={currentBanner.messageKey}
          components={{
            settingsLink: <VSCodeLink href="#" onClick={handleAction} />,
          }}
        />
      </div>

      {/* Action button */}
      {currentBanner.action && (
        <button
          onClick={handleAction}
          className="bg-vscode-button-background hover:bg-vscode-button-hoverBackground text-vscode-button-foreground px-3 py-1 rounded text-xs border border-vscode-button-border transition-colors"
        >
          {t(currentBanner.action.text)}
        </button>
      )}

      {/* Banner navigation */}
      {availableBanners.length > 1 && (
        <div className="flex justify-between items-center mt-3 pt-2 border-t border-vscode-panel-border/50">
          <button
            onClick={() => setCurrentBannerIndex((prev) => prev - 1)}
            className="text-xs text-vscode-foreground/60 hover:text-vscode-foreground transition-colors"
          >
            ← Previous
          </button>
          <span className="text-xs text-vscode-foreground/60">
            {(currentBannerIndex % availableBanners.length) + 1} /{" "}
            {availableBanners.length}
          </span>
          <button
            onClick={() => setCurrentBannerIndex((prev) => prev + 1)}
            className="text-xs text-vscode-foreground/60 hover:text-vscode-foreground transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
};

export default memo(FirstInstallBannerCarousel);
