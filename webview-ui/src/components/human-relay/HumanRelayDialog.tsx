import * as React from "react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Textarea } from "../ui/textarea";
import { useClipboard } from "../ui/hooks";
import { Check, Copy, X, Send, UserCheck, MessageSquare } from "lucide-react";
import { useAppTranslation } from "@/i18n/TranslationContext";
import { ShimmerText } from "../ui/shimmer-text";
import { cn } from "@/lib/utils";

interface HumanRelayDialogProps {
  isOpen: boolean;
  onClose: () => void;
  requestId: string;
  promptText: string;
  onSubmit: (requestId: string, text: string) => void;
  onCancel: (requestId: string) => void;
}

/**
 * Human Relay Dialog Component
 * Displays the prompt text that needs to be copied and provides an input box for the user to paste the AI's response.
 */
export const HumanRelayDialog: React.FC<HumanRelayDialogProps> = ({
  isOpen,
  onClose,
  requestId,
  promptText,
  onSubmit,
  onCancel,
}) => {
  const { t } = useAppTranslation();
  const [response, setResponse] = React.useState("");
  const { copy } = useClipboard();
  const [isCopyClicked, setIsCopyClicked] = React.useState(false);

  // Clear input when dialog opens
  React.useEffect(() => {
    if (isOpen) {
      setResponse("");
      setIsCopyClicked(false);
    }
  }, [isOpen]);

  // Copy to clipboard and show success message
  const handleCopy = () => {
    copy(promptText);
    setIsCopyClicked(true);
    setTimeout(() => {
      setIsCopyClicked(false);
    }, 2000);
  };

  // Submit response
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (response.trim()) {
      onSubmit(requestId, response);
      onClose();
    }
  };

  // Cancel operation
  const handleCancel = () => {
    onCancel(requestId);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent className="bg-[#1e1e1e] border border-[#333] p-0 overflow-hidden sm:max-w-[600px] max-h-[85vh] shadow-2xl">
        <div className="relative p-6 flex flex-col h-full overflow-y-auto custom-scrollbar">
          {/* Close button top right */}
          <button
            onClick={handleCancel}
            className="absolute right-4 top-4 text-vscode-descriptionForeground/60 hover:text-vscode-foreground transition-colors p-1"
          >
            <X size={18} />
          </button>

          <DialogHeader className="space-y-2 mb-6">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-vscode-button-background/10 text-vscode-button-background">
                <UserCheck size={18} />
              </div>
              <DialogTitle className="text-xl font-semibold tracking-tight text-vscode-foreground">
                {t("humanRelay:dialogTitle")}
              </DialogTitle>
            </div>
            <DialogDescription className="text-vscode-descriptionForeground/80 text-sm leading-normal ml-11">
              {t("humanRelay:dialogDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 pb-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold text-vscode-descriptionForeground uppercase tracking-widest flex items-center gap-2">
                  <MessageSquare size={12} />
                  Prompt to Copy
                </label>
                {isCopyClicked && (
                  <div className="text-[11px] text-emerald-500 font-medium animate-fade-in flex items-center gap-1">
                    <Check size={10} />
                    {t("humanRelay:copiedToClipboard")}
                  </div>
                )}
              </div>
              <div className="relative group">
                <Textarea
                  className="min-h-[160px] font-mono text-xs p-4 pr-12 whitespace-pre-wrap bg-vscode-input-background border-vscode-input-border rounded-lg focus:border-vscode-focusBorder transition-all custom-scrollbar overflow-y-auto"
                  value={promptText}
                  readOnly
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-2 right-2 h-8 w-8 rounded-md bg-vscode-button-background/10 hover:bg-vscode-button-background/20 border border-white/5 transition-all"
                  onClick={handleCopy}
                >
                  {isCopyClicked ? (
                    <Check className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-bold text-vscode-descriptionForeground uppercase tracking-widest flex items-center gap-2">
                <Send size={12} />
                {t("humanRelay:aiResponse.label")}
              </label>
              <Textarea
                placeholder={t("humanRelay:aiResponse.placeholder")}
                value={response}
                onChange={(e) => setResponse(e.target.value)}
                className="min-h-[140px] p-4 bg-vscode-input-background border-vscode-input-border rounded-lg focus:border-vscode-focusBorder transition-all text-sm custom-scrollbar overflow-y-auto"
              />
            </div>
          </div>

          <DialogFooter className="flex sm:flex-row flex-col gap-3 mt-8 pt-4 border-t border-white/5">
            <Button
              variant="outline"
              onClick={handleCancel}
              className="flex-1 h-9 rounded-md border-vscode-foreground/20 text-vscode-foreground hover:bg-vscode-foreground/5 transition-all text-sm font-medium"
            >
              {t("humanRelay:actions.cancel")}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!response.trim()}
              className="flex-[1.5] h-9 rounded-md bg-vscode-button-background hover:bg-vscode-button-hoverBackground text-vscode-button-foreground font-semibold border-none text-sm transition-all active:scale-[0.98] disabled:opacity-50"
            >
              <Check className="h-4 w-4 mr-1.5" />
              {t("humanRelay:actions.submit")}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
};
