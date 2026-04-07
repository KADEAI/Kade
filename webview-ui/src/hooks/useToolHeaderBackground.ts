import { useMemo, type CSSProperties } from "react";
import { css } from "styled-components";

import { useExtensionState } from "@/context/ExtensionStateContext";
import { useEmptyStateBackgrounds } from "@/hooks/useEmptyStateBackgrounds";
import type { ToolHeaderBackgroundConfig } from "@roo-code/types";

export type ToolHeaderBackgroundTarget = Exclude<
  keyof ToolHeaderBackgroundConfig,
  "global"
>;

type ToolHeaderBackgroundStyle = CSSProperties & {
  "--tool-header-overlay-image"?: string;
  "--tool-header-overlay-opacity"?: string;
};

const TOOL_HEADER_OVERLAY_OPACITY = "1";
const TOOL_HEADER_OVERLAY_HIDDEN_STYLE: ToolHeaderBackgroundStyle = {
  "--tool-header-overlay-image": "none",
  "--tool-header-overlay-opacity": "0",
};

const normalizeBackgroundSource = (value?: string) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const resolveBackgroundSource = (
  value: string | undefined,
  options: Array<{ file: string; uri: string }>,
) => {
  const normalizedValue = normalizeBackgroundSource(value);
  if (!normalizedValue) {
    return undefined;
  }

  const matchedOption = options.find(
    (option) =>
      option.file === normalizedValue || option.uri === normalizedValue,
  );

  return matchedOption?.uri ?? normalizedValue;
};

const toCssBackgroundImage = (value: string) => `url(${JSON.stringify(value)})`;

export const toolHeaderBackgroundOverlayCss = css`
  isolation: isolate;

  &::after {
    content: "";
    position: absolute;
    inset: 0;
    background-image: var(--tool-header-overlay-image, none);
    background-position: center;
    background-repeat: repeat-x;
    background-size: auto 100%;
    opacity: var(--tool-header-overlay-opacity, 0);
    mix-blend-mode: normal;
    pointer-events: none;
    z-index: 0;
  }
`;

export const useToolHeaderBackground = (target: ToolHeaderBackgroundTarget) => {
  const { toolHeaderBackgrounds, toolHeaderBackgroundUris } =
    useExtensionState();
  const { options } = useEmptyStateBackgrounds();

  return useMemo(() => {
    const resolvedUriFromState =
      toolHeaderBackgroundUris?.[target] ?? toolHeaderBackgroundUris?.global;
    const imageUrl = resolveBackgroundSource(
      resolvedUriFromState ??
        toolHeaderBackgrounds?.[target] ??
        toolHeaderBackgrounds?.global,
      options,
    );

    if (!imageUrl) {
      return {
        hasBackground: false,
        imageUrl: undefined,
        style: TOOL_HEADER_OVERLAY_HIDDEN_STYLE,
      };
    }

    return {
      hasBackground: true,
      imageUrl,
      style: {
        "--tool-header-overlay-image": toCssBackgroundImage(imageUrl),
        "--tool-header-overlay-opacity": TOOL_HEADER_OVERLAY_OPACITY,
      } as ToolHeaderBackgroundStyle,
    };
  }, [options, target, toolHeaderBackgrounds, toolHeaderBackgroundUris]);
};
