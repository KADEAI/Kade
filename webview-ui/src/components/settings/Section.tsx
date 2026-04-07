import { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type SectionProps = HTMLAttributes<HTMLDivElement>;

export const Section = ({ className, ...props }: SectionProps) => (
  <div
    className={cn(
      "flex flex-col gap-4 p-5 bg-transparent font-sans",
      className,
    )}
    {...props}
  />
);
