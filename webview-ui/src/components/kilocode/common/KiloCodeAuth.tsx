import React, { useEffect, useState } from "react";
import { ButtonPrimary } from "./ButtonPrimary";
import Logo from "./Logo";
import { useAppTranslation } from "@/i18n/TranslationContext";
import { vscode } from "@/utils/vscode";
import DeviceAuthCard from "./DeviceAuthCard";

type DeviceAuthStatus =
  | "idle"
  | "initiating"
  | "pending"
  | "success"
  | "error"
  | "cancelled";

interface KiloCodeAuthProps {
  className?: string;
  /** When true, shows a simple Continue button that dismisses the welcome screen (no login). */
  welcomeMode?: boolean;
}

const KiloCodeAuth: React.FC<KiloCodeAuthProps> = ({
  className = "",
  welcomeMode = false,
}) => {
  const { t } = useAppTranslation();
  const [deviceAuthStatus, setDeviceAuthStatus] =
    useState<DeviceAuthStatus>("idle");
  const [deviceAuthCode, setDeviceAuthCode] = useState<string>();
  const [deviceAuthVerificationUrl, setDeviceAuthVerificationUrl] =
    useState<string>();
  const [deviceAuthExpiresIn, setDeviceAuthExpiresIn] = useState<number>();
  const [deviceAuthTimeRemaining, setDeviceAuthTimeRemaining] =
    useState<number>();
  const [deviceAuthError, setDeviceAuthError] = useState<string>();
  const [deviceAuthUserEmail, setDeviceAuthUserEmail] = useState<string>();

  // Listen for device auth messages from extension
  useEffect(() => {
    if (welcomeMode) return;
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      switch (message.type) {
        case "deviceAuthStarted":
          setDeviceAuthStatus("pending");
          setDeviceAuthCode(message.deviceAuthCode);
          setDeviceAuthVerificationUrl(message.deviceAuthVerificationUrl);
          setDeviceAuthExpiresIn(message.deviceAuthExpiresIn);
          setDeviceAuthTimeRemaining(message.deviceAuthExpiresIn);
          setDeviceAuthError(undefined);
          break;
        case "deviceAuthPolling":
          setDeviceAuthTimeRemaining(message.deviceAuthTimeRemaining);
          break;
        case "deviceAuthComplete":
          setDeviceAuthStatus("success");
          setDeviceAuthUserEmail(message.deviceAuthUserEmail);
          vscode.postMessage({
            type: "deviceAuthCompleteWithProfile",
            text: "",
            values: {
              token: message.deviceAuthToken,
              userEmail: message.deviceAuthUserEmail,
            },
          });
          setTimeout(() => {
            vscode.postMessage({ type: "switchTab", tab: "chat" });
          }, 2000);
          break;
        case "deviceAuthFailed":
          setDeviceAuthStatus("error");
          setDeviceAuthError(message.deviceAuthError);
          break;
        case "deviceAuthCancelled":
          setDeviceAuthStatus("idle");
          setDeviceAuthCode(undefined);
          setDeviceAuthVerificationUrl(undefined);
          setDeviceAuthExpiresIn(undefined);
          setDeviceAuthTimeRemaining(undefined);
          setDeviceAuthError(undefined);
          break;
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [welcomeMode]);

  const handleContinue = () => {
    // Persist dismissal in webview state so it survives reloads
    const currentState = (vscode.getState() as Record<string, unknown>) || {};
    vscode.setState({ ...currentState, welcomeDismissed: true });
    // Dispatch a custom event so ExtensionStateContext can react immediately
    window.dispatchEvent(new CustomEvent("welcomeDismissed"));
  };

  const handleStartDeviceAuth = () => {
    setDeviceAuthStatus("initiating");
    vscode.postMessage({ type: "startDeviceAuth" });
  };

  const handleCancelDeviceAuth = () => {
    setDeviceAuthStatus("idle");
    setDeviceAuthCode(undefined);
    setDeviceAuthVerificationUrl(undefined);
    setDeviceAuthExpiresIn(undefined);
    setDeviceAuthTimeRemaining(undefined);
    setDeviceAuthError(undefined);
  };

  const handleRetryDeviceAuth = () => {
    setDeviceAuthStatus("idle");
    setDeviceAuthError(undefined);
    setTimeout(() => handleStartDeviceAuth(), 100);
  };

  // Show device auth card if auth is in progress (profile/login mode only)
  if (!welcomeMode && deviceAuthStatus !== "idle") {
    return (
      <div className={`flex flex-col items-center ${className}`}>
        <DeviceAuthCard
          code={deviceAuthCode}
          verificationUrl={deviceAuthVerificationUrl}
          expiresIn={deviceAuthExpiresIn}
          timeRemaining={deviceAuthTimeRemaining}
          status={deviceAuthStatus}
          error={deviceAuthError}
          userEmail={deviceAuthUserEmail}
          onCancel={handleCancelDeviceAuth}
          onRetry={handleRetryDeviceAuth}
        />
      </div>
    );
  }

  if (welcomeMode) {
    return (
      <div
        className={`relative min-h-screen min-w-full overflow-hidden ${className}`}
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_color-mix(in_srgb,var(--vscode-textLink-foreground)_18%,transparent),transparent_38%),radial-gradient(circle_at_85%_15%,_color-mix(in_srgb,var(--vscode-charts-yellow)_16%,transparent),transparent_28%),linear-gradient(145deg,color-mix(in_srgb,var(--vscode-editor-background)_88%,black_12%),color-mix(in_srgb,var(--vscode-sideBar-background)_92%,black_8%))]" />
          <div className="absolute -left-16 top-14 h-44 w-44 rounded-full border border-white/8 bg-white/4 blur-2xl" />
          <div className="absolute bottom-12 right-[-3.5rem] h-56 w-56 rounded-full border border-white/10 bg-white/5 blur-3xl" />
          <div className="absolute left-[12%] top-[22%] h-px w-24 rotate-[-22deg] bg-white/20" />
          <div className="absolute right-[14%] top-[18%] h-px w-[4.5rem] rotate-[32deg] bg-white/20" />
          <div className="absolute bottom-[18%] left-[18%] h-px w-28 rotate-[12deg] bg-white/15" />
        </div>

        <div className="relative z-10 flex min-h-screen items-center justify-center px-5 py-8">
          <div className="grid w-full max-w-5xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <section className="relative overflow-hidden rounded-[28px] border border-white/10 bg-black/20 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:p-8">
              <div className="mb-10 flex items-center gap-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3 shadow-[0_12px_30px_rgba(0,0,0,0.18)]">
                  <Logo width={84} height={84} />
                </div>
                <div className="space-y-1">
                  <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.35em] text-vscode-descriptionForeground">
                    Kilo Code
                  </p>
                  <p className="m-0 max-w-xs text-sm leading-6 text-vscode-descriptionForeground">
                    An IDE-native coding partner with a calmer, more intentional
                    workspace.
                  </p>
                </div>
              </div>

              <div className="max-w-2xl">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.4em] text-vscode-textLink-foreground">
                  Welcome sequence
                </p>
                <h1 className="m-0 max-w-xl text-4xl leading-none font-semibold tracking-[-0.04em] text-vscode-foreground sm:text-5xl">
                  {t("kilocode:welcome.greeting")}
                </h1>
                <div className="mt-5 max-w-xl space-y-3 text-[15px] leading-7 text-vscode-descriptionForeground">
                  <p className="m-0">{t("kilocode:welcome.introText1")}</p>
                  <p className="m-0">{t("kilocode:welcome.introText2")}</p>
                  <p className="m-0">{t("kilocode:welcome.introText3")}</p>
                </div>
              </div>

              <div className="mt-10 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="m-0 text-[10px] uppercase tracking-[0.28em] text-vscode-descriptionForeground">
                    Flow
                  </p>
                  <p className="mt-2 mb-0 text-sm leading-6 text-vscode-foreground">
                    Stay in motion with fewer modal detours and clearer next
                    steps.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="m-0 text-[10px] uppercase tracking-[0.28em] text-vscode-descriptionForeground">
                    Clarity
                  </p>
                  <p className="mt-2 mb-0 text-sm leading-6 text-vscode-foreground">
                    Readable structure, focused surfaces, and less UI chatter.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="m-0 text-[10px] uppercase tracking-[0.28em] text-vscode-descriptionForeground">
                    Control
                  </p>
                  <p className="mt-2 mb-0 text-sm leading-6 text-vscode-foreground">
                    Bring your own workflow and move at the pace that feels
                    right.
                  </p>
                </div>
              </div>
            </section>

            <aside className="flex flex-col justify-between rounded-[28px] border border-white/10 bg-[color:color-mix(in_srgb,var(--vscode-sideBar-background)_88%,black_12%)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:p-8">
              <div>
                <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.35em] text-vscode-descriptionForeground">
                  Start here
                </p>
                <h2 className="mt-3 mb-0 text-2xl leading-tight font-semibold tracking-[-0.03em] text-vscode-foreground">
                  Step into the workspace and begin with a clean slate.
                </h2>
                <p className="mt-4 mb-0 text-sm leading-7 text-vscode-descriptionForeground">
                  The welcome flow is intentionally lightweight. One tap takes
                  you into the main interface, and you can fine-tune the rest
                  once you are inside.
                </p>
              </div>

              <div className="mt-8 space-y-4">
                <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                  <p className="m-0 text-[10px] uppercase tracking-[0.28em] text-vscode-descriptionForeground">
                    Next
                  </p>
                  <p className="mt-2 mb-0 text-sm leading-6 text-vscode-foreground">
                    Open chat, explore the interface, and shape the setup from
                    inside the app.
                  </p>
                </div>

                <ButtonPrimary onClick={handleContinue}>
                  {t("kilocode:welcome.ctaButton")}
                </ButtonPrimary>
              </div>
            </aside>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col items-center relative min-h-screen min-w-full ${className}`}
    >
      {/* Bubble effect covering entire window */}
      <div className="fixed inset-0 overflow-visible pointer-events-none">
        <div className="absolute inset-0">
          {/* Floating bubbles across entire window */}
          <div className="absolute top-5 left-5 w-20 h-20 bg-gradient-to-br from-purple-400/30 to-purple-600/20 rounded-full mix-blend-screen filter blur-xl animate-pulse-slow animate-float-1 bubble-glow"></div>
          <div className="absolute top-10 right-10 w-24 h-24 bg-gradient-to-br from-cyan-400/30 to-cyan-600/20 rounded-full mix-blend-screen filter blur-xl animate-pulse-slow animation-delay-8000 animate-float-2 bubble-glow"></div>
          <div className="absolute bottom-20 left-10 w-28 h-28 bg-gradient-to-br from-pink-400/30 to-pink-600/20 rounded-full mix-blend-screen filter blur-xl animate-pulse-slow animation-delay-16000 animate-float-3 bubble-glow"></div>
          <div className="absolute top-1/4 right-1/6 w-16 h-16 bg-gradient-to-br from-indigo-400/30 to-indigo-600/20 rounded-full mix-blend-screen filter blur-xl animate-pulse-slow animation-delay-4000 animate-float-4 bubble-glow"></div>
          <div className="absolute bottom-10 right-20 w-18 h-18 bg-gradient-to-br from-violet-400/30 to-violet-600/20 rounded-full mix-blend-screen filter blur-xl animate-pulse-slow animation-delay-12000 animate-float-5 bubble-glow"></div>
          <div className="absolute top-1/2 left-10 w-14 h-14 bg-gradient-to-br from-blue-400/30 to-blue-600/20 rounded-full mix-blend-screen filter blur-xl animate-pulse-slow animation-delay-6000 animate-float-6 bubble-glow"></div>
          <div className="absolute bottom-1/4 left-1/2 w-16 h-16 bg-gradient-to-br from-teal-400/30 to-teal-600/20 rounded-full mix-blend-screen filter blur-xl animate-pulse-slow animation-delay-14000 animate-float-7 bubble-glow"></div>
          <div className="absolute top-3/4 right-1/4 w-12 h-12 bg-gradient-to-br from-purple-300/30 to-purple-500/20 rounded-full mix-blend-screen filter blur-xl animate-pulse-slow animation-delay-10000 animate-float-8 bubble-glow"></div>

          {/* Additional bubbles for full coverage */}
          <div className="absolute top-1/6 left-1/3 w-16 h-16 bg-gradient-to-br from-blue-300/30 to-blue-500/20 rounded-full mix-blend-screen filter blur-xl animate-pulse-slow animation-delay-5000 animate-float-1 bubble-glow"></div>
          <div className="absolute top-2/3 right-1/5 w-20 h-20 bg-gradient-to-br from-green-400/30 to-green-600/20 rounded-full mix-blend-screen filter blur-xl animate-pulse-slow animation-delay-11000 animate-float-3 bubble-glow"></div>
          <div className="absolute bottom-1/6 left-1/4 w-18 h-18 bg-gradient-to-br from-yellow-400/30 to-yellow-600/20 rounded-full mix-blend-screen filter blur-xl animate-pulse-slow animation-delay-7000 animate-float-5 bubble-glow"></div>
          <div className="absolute top-1/5 right-1/3 w-14 h-14 bg-gradient-to-br from-red-400/30 to-red-600/20 rounded-full mix-blend-screen filter blur-xl animate-pulse-slow animation-delay-13000 animate-float-7 bubble-glow"></div>
          <div className="absolute top-4/5 left-1/6 w-22 h-22 bg-gradient-to-br from-orange-400/30 to-orange-600/20 rounded-full mix-blend-screen filter blur-xl animate-pulse-slow animation-delay-9000 animate-float-2 bubble-glow"></div>
          <div className="absolute bottom-1/5 right-2/3 w-16 h-16 bg-gradient-to-br from-cyan-300/30 to-cyan-500/20 rounded-full mix-blend-screen filter blur-xl animate-pulse-slow animation-delay-15000 animate-float-4 bubble-glow"></div>
          <div className="absolute top-3/5 left-2/5 w-12 h-12 bg-gradient-to-br from-purple-300/30 to-purple-500/20 rounded-full mix-blend-screen filter blur-xl animate-pulse-slow animation-delay-3000 animate-float-6 bubble-glow"></div>
          <div className="absolute top-1/8 right-1/8 w-26 h-26 bg-gradient-to-br from-pink-300/30 to-pink-500/20 rounded-full mix-blend-screen filter blur-xl animate-pulse-slow animation-delay-17000 animate-float-8 bubble-glow"></div>

          {/* Small accent bubbles */}
          <div className="absolute top-1/3 left-1/4 w-8 h-8 bg-gradient-to-br from-indigo-300/25 to-indigo-500/15 rounded-full mix-blend-screen filter blur-lg animate-pulse-slow animation-delay-2000 animate-float-1"></div>
          <div className="absolute top-2/5 right-1/3 w-10 h-10 bg-gradient-to-br from-teal-300/25 to-teal-500/15 rounded-full mix-blend-screen filter blur-lg animate-pulse-slow animation-delay-12000 animate-float-3"></div>
          <div className="absolute bottom-1/3 right-1/4 w-6 h-6 bg-gradient-to-br from-pink-300/25 to-pink-500/15 rounded-full mix-blend-screen filter blur-lg animate-pulse-slow animation-delay-8000 animate-float-5"></div>
          <div className="absolute top-3/4 left-1/5 w-8 h-8 bg-gradient-to-br from-cyan-300/25 to-cyan-500/15 rounded-full mix-blend-screen filter blur-lg animate-pulse-slow animation-delay-14000 animate-float-7"></div>
        </div>
      </div>

      {/* Logo with 3px right margin */}
      <div className="ml-3 relative z-10">
        <Logo width={150} height={150} />
      </div>

      <div className="relative z-10 text-center">
        <h2 className="m-0 p-0 mb-4">{t("kilocode:welcome.greeting")}</h2>
        <p className="text-center mb-2">{t("kilocode:welcome.introText1")}</p>
        <p className="text-center mb-2">{t("kilocode:welcome.introText2")}</p>
        <p className="text-center mb-5">{t("kilocode:welcome.introText3")}</p>

        <div className="w-full flex flex-col gap-5">
          {welcomeMode ? (
            <ButtonPrimary onClick={handleContinue}>
              {t("kilocode:welcome.ctaButton")}
            </ButtonPrimary>
          ) : (
            <ButtonPrimary onClick={handleStartDeviceAuth}>
              {t("kilocode:welcome.ctaButton")}
            </ButtonPrimary>
          )}
        </div>
      </div>
    </div>
  );
};

export default KiloCodeAuth;
