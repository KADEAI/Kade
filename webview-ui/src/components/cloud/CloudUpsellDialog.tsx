import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, Button } from "@/components/ui";
import RooHero from "../welcome/RooHero";
import {
  ArrowRight,
  Brain,
  Cable,
  CircleDollarSign,
  FileStack,
  Router,
  Users2,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { DialogTitle } from "@radix-ui/react-dialog";
import { ShimmerText } from "../ui/shimmer-text";
import { cn } from "@/lib/utils";

interface CloudUpsellDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: () => void;
}

// Reusable method to render cloud benefits content
export const renderCloudBenefitsContent = (t: any) => {
  const benefits = [
    {
      icon: Brain,
      text: t("cloud:cloudBenefitProvider"),
      color: "text-blue-400",
    },
    {
      icon: Users2,
      text: t("cloud:cloudBenefitCloudAgents"),
      color: "text-purple-400",
    },
    {
      icon: Cable,
      text: t("cloud:cloudBenefitTriggers"),
      color: "text-emerald-400",
    },
    {
      icon: Router,
      text: t("cloud:cloudBenefitWalkaway"),
      color: "text-orange-400",
    },
    {
      icon: CircleDollarSign,
      text: t("cloud:cloudBenefitMetrics"),
      color: "text-amber-400",
    },
    {
      icon: FileStack,
      text: t("cloud:cloudBenefitHistory"),
      color: "text-indigo-400",
    },
  ];

  return (
    <div className="text-left cursor-default space-y-6">
      <div className="flex items-center justify-center p-4 rounded-3xl bg-white/5 border border-white/10 shadow-inner">
        <div className="w-16 h-16 transform hover:scale-110 transition-transform duration-500">
          <RooHero />
        </div>
      </div>

      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-black text-vscode-foreground tracking-tight">
          <ShimmerText foregroundColor="var(--vscode-foreground)">
            {t("cloud:cloudBenefitsTitle")}
          </ShimmerText>
        </h1>
        <p className="text-vscode-descriptionForeground text-sm opacity-70">
          Unlock the full power of KiloCode with AI Cloud Features
        </p>
      </div>

      <div className="grid gap-3 pt-2">
        {benefits.map((benefit, index) => (
          <div
            key={index}
            className="flex items-center gap-3 p-3 rounded-2xl bg-white/5 border border-white/5 hover:border-white/10 transition-all group active:scale-[0.98]"
          >
            <div
              className={cn(
                "flex items-center justify-center w-8 h-8 rounded-xl bg-opacity-10",
                benefit.color.replace("text", "bg"),
              )}
            >
              <benefit.icon
                className={cn(
                  "size-4 group-hover:scale-110 transition-transform",
                  benefit.color,
                )}
              />
            </div>
            <span className="text-sm font-medium text-vscode-descriptionForeground group-hover:text-vscode-foreground transition-colors">
              {benefit.text}
            </span>
            <CheckCircle2 className="size-3 ms-auto text-emerald-500/50 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        ))}
      </div>
    </div>
  );
};

export const CloudUpsellDialog = ({
  open,
  onOpenChange,
  onConnect,
}: CloudUpsellDialogProps) => {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-panel border-white/10 p-0 overflow-hidden max-w-[400px]">
        <div className="relative p-8 space-y-8">
          <DialogHeader>
            <DialogTitle className="sr-only">Cloud Benefits</DialogTitle>
          </DialogHeader>

          {renderCloudBenefitsContent(t)}

          <div className="flex flex-col gap-4 pt-2">
            <Button
              variant="primary"
              onClick={onConnect}
              className="w-full h-12 rounded-2xl bg-gradient-to-r from-primary to-blue-600 hover:from-primary/90 hover:to-blue-500 font-bold text-lg shimmer-btn border-none shadow-xl shadow-primary/20 transition-all active:scale-[0.97] flex items-center justify-center gap-2"
            >
              <Sparkles size={18} />
              {t("cloud:connect")}
              <ArrowRight size={18} className="ms-1" />
            </Button>
            <p className="text-[10px] text-center text-vscode-descriptionForeground uppercase tracking-widest opacity-40 font-bold">
              Enterprise Grade Intelligence
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
