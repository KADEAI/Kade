import React from "react";
import { useTranslation } from "react-i18next";
import { vscode } from "@src/utils/vscode";
import CodeBlock from "../common/CodeBlock";

interface CodebaseSearchResultProps {
  filePath: string;
  score: number;
  startLine: number;
  endLine: number;
  snippet: string;
  language: string;
}

const SimilarityGauge = ({ score }: { score: number }) => {
  const percentage = Math.round(score * 100);
  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <div className="relative flex items-center justify-center w-12 h-12">
      <svg className="w-full h-full transform -rotate-90">
        <circle
          cx="24"
          cy="24"
          r={radius}
          stroke="currentColor"
          strokeWidth="2.5"
          fill="transparent"
          className="text-white/10"
        />
        <circle
          cx="24"
          cy="24"
          r={radius}
          stroke="currentColor"
          strokeWidth="2.5"
          fill="transparent"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="text-[var(--color-electric-cyan)] transition-[stroke-dashoffset] duration-1000 ease-out"
        />
      </svg>
      <span className="absolute text-[9px] font-bold text-[var(--color-electric-cyan)]">
        {percentage}%
      </span>
    </div>
  );
};

const CodebaseSearchResult: React.FC<CodebaseSearchResultProps> = ({
  filePath,
  score,
  startLine,
  endLine,
  snippet,
  language,
}) => {
  const { t } = useTranslation("chat");

  const handleClick = () => {
    vscode.postMessage({
      type: "openFile",
      text: "./" + filePath,
      values: {
        line: startLine,
      },
    });
  };

  return (
    <div className="flex flex-col overflow-hidden group/card relative">
      <div
        onClick={handleClick}
        className="flex items-center justify-between px-3 py-2 bg-white/5 border-b border-white/5 cursor-pointer hover:bg-white/10 transition-colors"
      >
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-bold text-[var(--color-electric-cyan)] truncate">
            {filePath.split("/").at(-1)}
          </span>
          <span className="text-[10px] text-vscode-descriptionForeground truncate opacity-60">
            {filePath.split("/").slice(0, -1).join("/") || "./"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono opacity-50 bg-black/20 px-1.5 py-0.5 rounded">
            L{startLine === endLine ? startLine : `${startLine}-${endLine}`}
          </span>
          <SimilarityGauge score={score} />
        </div>
      </div>

      <div className="relative group/code cursor-pointer" onClick={handleClick}>
        <CodeBlock language={language || "plaintext"} source={snippet} />
        {/* Subtle fade-out at the bottom */}
        <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[#1e1e23] to-transparent pointer-events-none opacity-80 group-hover/code:opacity-40 transition-opacity" />

        {/* Hover Glow Effect */}
        <div className="absolute inset-0 border-1 border-transparent group-hover/code:border-[var(--color-electric-cyan)]/20 pointer-events-none transition-colors" />
      </div>
    </div>
  );
};

export default CodebaseSearchResult;
