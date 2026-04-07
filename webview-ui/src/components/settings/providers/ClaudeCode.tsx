import React from "react";

import { useAppTranslation } from "@src/i18n/TranslationContext";
import { Button } from "@src/components/ui";
import { vscode } from "@src/utils/vscode";

import { ClaudeCodeRateLimitDashboard } from "./ClaudeCodeRateLimitDashboard";

interface ClaudeCodeProps {
  claudeCodeIsAuthenticated?: boolean;
}

export const ClaudeCode: React.FC<ClaudeCodeProps> = ({
  claudeCodeIsAuthenticated = false,
}) => {
  const { t } = useAppTranslation();

  return (
    <div className="flex flex-col gap-4">
      {/* Authentication Section */}
      <div className="flex flex-col gap-2">
        {claudeCodeIsAuthenticated ? (
          <div className="flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => vscode.postMessage({ type: "claudeCodeSignOut" })}
            >
              {t("settings:providers.claudeCode.signOutButton")}
            </Button>
          </div>
        ) : (
          <Button
            variant="primary"
            onClick={() => vscode.postMessage({ type: "claudeCodeSignIn" })}
            className="w-fit"
          >
            {t("settings:providers.claudeCode.signInButton")}
          </Button>
        )}
      </div>

      {/* Rate Limit Dashboard - only shown when authenticated */}
      <ClaudeCodeRateLimitDashboard
        isAuthenticated={claudeCodeIsAuthenticated}
      />
    </div>
  );
};
